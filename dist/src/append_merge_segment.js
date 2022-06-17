//
// append_merge_segment.ts by Clarkok Zhang
//
// This file contains the implementation of the AppendMergeSegment together with a few helper methods. The
// AppendMergeSegment is a helper class that manages the serialization and the deserialized cache of a single segment,
// with very little overhead.
//
// The basic idea of the AppendMergeSegment is, when updating we try our best to only serialize the delta change in the
// tick, and append that serialized delta to the previous serialized string. So we only need to pay serialization cost
// for what changed. And as the serialized string accumulates, we only compact once in a while to remove the duplicated
// entries in the serialized form.
//
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AppendMergeSegment = exports.DeepCopy = exports.EscapeAndJoin = exports.SplitAndUnescape = void 0;
    /**
     * Split the string with a delimiter, in a safe way. It should be used together with {@link EscapeAndJoin}
     *
     * @param {string} s - The string to split
     * @param {string} delim - The delimiter used to split, it should be only a single char
     */
    function* SplitAndUnescape(s, delim) {
        if (delim.length != 1) {
            throw new Error(`invalid delim: '${delim}'`);
        }
        let start = 0;
        let part = '';
        for (let i = 0; i < s.length; ++i) {
            if (s[i] == '\\') {
                part += s.substring(start, i);
                part += s[i + 1];
                start = i + 2;
                ++i;
            }
            else if (s[i] == delim) {
                yield part + s.substring(start, i);
                start = i + 1;
                part = '';
            }
        }
        yield part + s.substring(start);
    }
    exports.SplitAndUnescape = SplitAndUnescape;
    /**
     * Escape the parts and join them with a delimiter, in a safe way. It should be used together with
     * {@link SplitAndUnescape}
     *
     * @param {string[]} parts - The parts to escape and join
     * @param {string} delim - The delimiter used to split, it should be only a single char
     */
    function EscapeAndJoin(parts, delim) {
        if (delim.length != 1) {
            throw new Error(`invalid delim: '${delim}'`);
        }
        return parts
            .map(p => p
            .replace(/\\/g, '\\\\')
            .split(delim)
            .join('\\' + delim))
            .join(delim);
    }
    exports.EscapeAndJoin = EscapeAndJoin;
    /**
     * DeepCopy of an object
     */
    function DeepCopy(obj) {
        if (typeof obj == 'object') {
            return JSON.parse(JSON.stringify(obj));
        }
        return obj;
    }
    exports.DeepCopy = DeepCopy;
    class AppendMergeSegment {
        /**
         * constructor of the AppendMergeSegment
         *
         * Note:
         *   You should NOT use `undefined` or `null` as your value, they are reserved for internal use. But your
         *   `serialize` and `deserialize` need to correcly handle the case where the value is null.
         *
         * @constructor
         * @param {string} delim - The delimiter between key-value pairs, you should choose a char that is not common in
         *                         the serialized string of your type T
         * @param {string} lastSerialized - Current value of the segment, or an empty string if there is nothing
         * @param {(s: string) => [string, T | null]} deserialize - A function to deserialize key-value pairs
         * @param {(k: string, v: T | null) => string} serialize - A function to serialize key-value pairs
         */
        constructor(delim, lastSerialized, deserialize, serialize) {
            this.delim = delim;
            this.deserialize = deserialize;
            this.serialize = serialize;
            this.lastSerialized = lastSerialized;
            this.delta = new Map();
        }
        /**
         * Get the value of the given key in the segment
         *
         * @param {string} k - The key to get
         * @returns {T | undefined} - The value associated with the key, or undefined if not found
         */
        get(k) {
            const v = this.delta.get(k);
            if (v !== undefined) {
                if (v == null) {
                    return undefined;
                }
                return DeepCopy(v);
            }
            const current = this.initCurrent();
            const cv = current.get(k);
            if (cv === undefined) {
                return undefined;
            }
            return DeepCopy(cv);
        }
        /**
         * Set the value of the given key in the segment
         *
         * @param {string} k - The key to get
         * @param {T} v - The value to be associated with the key
         */
        set(k, v) {
            this.delta.set(k, DeepCopy(v));
        }
        /**
         * Delete the given key in the segment
         *
         * @param {string} k - The key to get
         */
        delete(k) {
            if (!this.current) {
                this.delta.set(k, null);
            }
            else if (this.current.has(k)) {
                this.delta.set(k, null);
            }
            else {
                this.delta.delete(k);
            }
        }
        /**
         * @returns {number} - the number of keys at the last write, not including the updates made later
         */
        get size() {
            return this.initCurrent().size;
        }
        /**
         * @returns {number} - the number of updates made after last write
         */
        get deltaSize() {
            return this.delta.size;
        }
        /**
         * @returns {number} - the serialized length at the last write
         */
        get lastSerializedLength() {
            return this.lastSerialized.length;
        }
        /**
         * @returns {Generator<string>} - a generator to go through all keys that are set, but not deleted in the segment,
         *                                in random order
         */
        *keys() {
            const current = this.initCurrent();
            for (const k of current.keys()) {
                if (!this.delta.has(k) || this.delta.get(k) !== null) {
                    yield k;
                }
            }
            for (const [k, v] of this.delta.entries()) {
                if (!current.has(k) && v !== null) {
                    yield k;
                }
            }
        }
        /**
         * @returns {Generator<[string, T]>} - a generator to go through all entities, whose keys are set, but not deleted
         *                                     in the segment, in random order
         */
        *entries() {
            for (const k of this.keys()) {
                yield [k, this.get(k)];
            }
        }
        /**
         * Iterate key-value pairs in the segment, and delete some of them
         *
         * @param {(k: string, v: T) => boolean} cb - A callback, return true to delete the current key
         */
        removeIf(cb) {
            for (const [k, v] of this.entries()) {
                if (cb(k, v)) {
                    this.delete(k);
                }
            }
        }
        /**
         * Serialize the content of the segment
         *
         * @param {number} compactLimit - If the serialized length is larger than the compactLimit, we trigger a compaction
         * @returns {string | null} - The serialized segment content, or null if there is no update
         */
        write(compactLimit) {
            if (this.delta.size == 0) {
                return null;
            }
            const current = this.initCurrent();
            if (compactLimit == 0 || this.delta.size >= current.size * 0.7) {
                for (const [k, v] of this.delta.entries()) {
                    if (v === null) {
                        current.delete(k);
                    }
                    else {
                        current.set(k, v);
                    }
                }
                this.delta.clear();
            }
            else {
                const serializedDelta = EscapeAndJoin([...this.delta.entries()].map(([k, v]) => this.serialize(k, v)), this.delim);
                for (const [k, v] of this.delta.entries()) {
                    if (v === null) {
                        current.delete(k);
                    }
                    else {
                        current.set(k, v);
                    }
                }
                this.delta.clear();
                const serialized = this.lastSerialized.length
                    ? this.lastSerialized + this.delim + serializedDelta
                    : serializedDelta;
                if (serialized.length < compactLimit) {
                    this.lastSerialized = serialized;
                    return serialized;
                }
            }
            return (this.lastSerialized = EscapeAndJoin([...current.entries()].map(([k, v]) => this.serialize(k, v)), this.delim));
        }
        initCurrent() {
            if (this.current) {
                return this.current;
            }
            this.current = new Map();
            if (this.lastSerialized.length == 0) {
                return this.current;
            }
            for (const s of SplitAndUnescape(this.lastSerialized, this.delim)) {
                const [k, v] = this.deserialize(s);
                if (v === null) {
                    this.current.delete(k);
                }
                else {
                    this.current.set(k, v);
                }
            }
            return this.current;
        }
    }
    exports.AppendMergeSegment = AppendMergeSegment;
});
