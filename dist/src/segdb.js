//
// segdb.ts by Clarkok Zhang
//
// This file contains the implementation of the SegDB, a key-value database for the game Screeps that utilizes multiple
// segments. The SegDB can batch the updates in a tick, to minimize the CPU overhead and the number of segments to
// update. And from time to time checkpoint the updates to multiple partition segments to walkaround size limitation.
//
// The basic idea of the SegDB is to split the whole key space into a few range based partitions, with a set of split
// keys. Each partition have a low key and a high key, and all the user keys that greater than or equal to the low key
// and less than the high key fall into the partition. Each partition take one segment to store its key-value pairs.
// As the sizes of partitions change, balancing occurres from time to time, to ensure that we don't overflow.
//
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "./append_merge_segment"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SegDB = exports.SegDBListControl = void 0;
    const append_merge_segment_1 = require("./append_merge_segment");
    var SegDBListControl;
    (function (SegDBListControl) {
        SegDBListControl[SegDBListControl["Stop"] = 0] = "Stop";
        SegDBListControl[SegDBListControl["Yield"] = 1] = "Yield";
        SegDBListControl[SegDBListControl["Continue"] = 2] = "Continue";
    })(SegDBListControl = exports.SegDBListControl || (exports.SegDBListControl = {}));
    const DELETE_MARK = '$';
    const ESCAPED_DELETE_MARK = '\\$';
    function getDefaultSegDBConfig() {
        return {
            segmentMergeThreshold: 90000,
            writingThresholdToCheckPoint: 80000,
            splitThreshold: 90000,
            mergeThreshold: 80000,
            compactThresholdRatio: 0.8,
            compactTarget: 80000,
        };
    }
    class SegDB {
        /**
         * @constructor
         * @param {Partial<SegDBConfig>} conf - see {@link SegDBConfig} for details
         */
        constructor(conf) {
            this.config = Object.assign(getDefaultSegDBConfig(), conf !== null && conf !== void 0 ? conf : {});
            this.segments = new Map();
            this.writing = null;
            this.estimatedWritingSize = 0;
            this.getRequests = [];
            this.listRequests = [];
            this.checkpointing = null;
            this.splitQueue = [];
            this.merging = null;
            this.compacting = null;
        }
        /**
         * Initialize the Memory structure for the SegDB
         *
         * @param {number} allocateBegin - the start of the segment ids for the db to allocate
         * @param {number} allocateLimit - the limit of the segment ids for the db to allocate
         */
        resetOnRespawn(allocateBegin, allocateLimit) {
            const writing = allocateBegin++;
            const partitionSegment = allocateBegin++;
            Memory.segdb = {
                partitions: [
                    {
                        low: '',
                        high: null,
                        seg: partitionSegment,
                    },
                ],
                allocateBegin,
                allocateLimit,
                writing: writing,
                freedSegments: [],
            };
            RawMemory.segments[writing] = '';
            RawMemory.segments[partitionSegment] = '';
            this.segments.set(partitionSegment, SegDB.createAppendMergeSegment(''));
            this.writing = SegDB.createAppendMergeSegment('');
            this.estimatedWritingSize = 0;
        }
        /**
         * The first half of the tick work, collect the loaded segments and trigger callback for pending requests
         */
        tickStart() {
            if (!this.writing && RawMemory.segments[Memory.segdb.writing] !== undefined) {
                this.writing = SegDB.createAppendMergeSegment(RawMemory.segments[Memory.segdb.writing]);
                this.estimatedWritingSize = RawMemory.segments[Memory.segdb.writing].length;
            }
            if (!this.writing) {
                return;
            }
            if (this.segments.size != Memory.segdb.partitions.length) {
                for (const id of Object.keys(RawMemory.segments).map(id => parseInt(id))) {
                    if (this.segments.has(id)) {
                        continue;
                    }
                    const part = Memory.segdb.partitions.find(p => p.seg == id);
                    if (!part) {
                        continue;
                    }
                    this.segments.set(id, SegDB.createAppendMergeSegment(RawMemory.segments[id]));
                }
            }
            this.getRequests = this.getRequests.filter(g => {
                const tryResult = this.tryGet(g.key);
                if (tryResult === false) {
                    return true;
                }
                g.cb(tryResult, g.key);
                return false;
            });
            this.listRequests = this.listRequests.filter(g => {
                if (!g.proc) {
                    return false;
                }
                const res = g.proc.next();
                if (res.done) {
                    return false;
                }
                return true;
            });
        }
        /**
         * The second half of the tick work, serialize pending write, and handle load balancing operations
         *
         * @param {number[]} readingSegments - segment read requests from other components
         * @param {number} writeQuota - max number of segments this method can update in this tick
         * @param {number} cpuLimit - a timepoint to halt the load balancing operation
         */
        tickAfter(readingSegments, writeQuota, cpuLimit) {
            if (!this.writing) {
                if (readingSegments.length < 10) {
                    readingSegments.push(Memory.segdb.writing);
                }
                RawMemory.setActiveSegments(readingSegments);
                return;
            }
            // handle writing
            if (writeQuota && this.writing.deltaSize) {
                const writingSerialized = this.writing.write(this.config.segmentMergeThreshold);
                if (writingSerialized !== null) {
                    --writeQuota;
                    this.estimatedWritingSize = writingSerialized.length;
                    RawMemory.segments[Memory.segdb.writing] = writingSerialized;
                }
            }
            // handle reading
            if (readingSegments.length != 10 && this.segments.size != Memory.segdb.partitions.length) {
                const partitionsToRead = Memory.segdb.partitions.map(p => p.seg).filter(s => !this.segments.has(s));
                readingSegments.push(...partitionsToRead.slice(0, 10 - readingSegments.length));
            }
            RawMemory.setActiveSegments(readingSegments);
            if (this.splitQueue.length && Game.cpu.getUsed() < cpuLimit) {
                writeQuota = this.split(writeQuota, cpuLimit);
            }
            if (this.checkpointing === null &&
                this.estimatedWritingSize >= this.config.writingThresholdToCheckPoint &&
                Game.cpu.getUsed() < cpuLimit) {
                // start checkpoint
                this.checkpointing = '';
            }
            if (this.checkpointing !== null) {
                writeQuota = this.checkpoint(writeQuota, cpuLimit);
            }
            if (this.splitQueue.length && Game.cpu.getUsed() < cpuLimit) {
                writeQuota = this.split(writeQuota, cpuLimit);
            }
            if (this.merging != null && Game.cpu.getUsed() < cpuLimit) {
                writeQuota = this.merge(writeQuota, cpuLimit);
            }
            if (this.compacting != null && Game.cpu.getUsed() < cpuLimit) {
                writeQuota = this.compact(writeQuota, cpuLimit);
            }
        }
        /** A helper method to call {@link tickStart} and {@link tickAfter} */
        tick(readingSegments, writeQuota, cpuLimit) {
            this.tickStart();
            this.tickAfter(readingSegments, writeQuota, cpuLimit);
        }
        /** Get current stats of the db */
        getStats() {
            if (!this.writing || this.segments.size != Memory.segdb.partitions.length) {
                return null;
            }
            const writingLength = this.estimatedWritingSize;
            const totalLength = [...this.segments.values()].reduce((p, c) => p + c.lastSerializedLength, 0) + writingLength;
            const segments = this.segments.size;
            return {
                totalLength,
                segments,
                writingLength,
                spaceLimit: (segments +
                    Memory.segdb.freedSegments.length +
                    Memory.segdb.allocateLimit -
                    Memory.segdb.allocateBegin) *
                    100000,
            };
        }
        /**
         * Try get the assiociated value of a specified key in the memory cache only
         *
         * Compared to the {@link get}, this method can return instantly in a non-blocking manner, but if the hosting
         * segment has not been loaded yet, the method will fail and return false
         *
         * @param {string} k - the key to search
         * @returns {false|undefined|string} - the assiociated value, or undefined if the key is not found, or false if the
         *                                     segment is not yet loaded
         */
        tryGet(k) {
            if (!this.writing) {
                return false;
            }
            let ret = this.writing.get(k);
            if (ret !== undefined) {
                if (ret == DELETE_MARK) {
                    return undefined;
                }
                else if (ret == ESCAPED_DELETE_MARK) {
                    return DELETE_MARK;
                }
                else if (ret.length > 0 && ret[0] == '\\') {
                    return ret.substring(1);
                }
                else {
                    return ret;
                }
            }
            const seg = SegDB.getPartitionSegForKey(k);
            const loadedSegment = this.segments.get(seg);
            if (!loadedSegment) {
                return false;
            }
            ret = loadedSegment.get(k);
            return ret;
        }
        /**
         * Get the assiociated value of a specified key in the database
         *
         * Compared to the {@link tryGet}, this method can guarentee get the value or report key not found, but if the
         * hosting segment has not been loaded yet, the method will record the request, and call the callback method
         * {@link cb} on a tick in the future.
         *
         * Note: the callback will be called eventually, no matter the key is found or not. If the hosting segment is
         * already loaded the callback will be called instantly before the method returns.
         *
         * @param {string} k - the key to search
         * @param {(v: string | undefined, k: string) => void} cb - the callback when the value is ready
         * @returns {boolean} - true if the result has been returned already, or false if the request has been recorded
         */
        get(k, cb) {
            const tryResult = this.tryGet(k);
            if (tryResult === false) {
                this.getRequests.push({ key: k, cb });
                return false;
            }
            cb(tryResult, k);
            return true;
        }
        /**
         * Set the specified key to a specified value
         *
         * Note: this method and the {@link delete} method can fail because of potential writing segment overflow, but once
         * the writing methods return true, and there is at least 1 writing quota when calling the {@link tickAfter}, the
         * write will be guarenteed to be persisted.
         *
         * Reasons that may cause writing segment too large
         *  1. there is too many writes already in this tick
         *  2. in the previous ticks, the writeQuota or cpuLimit was too tight, that the checkpoint could not proceed
         *  3. the database is almost full, that stall the checkpoint operation
         *
         * @param {string} k - the key to set
         * @param {string} v - the value to set
         * @returns {boolean} - true if the write has been recorded, but yet to be persisted into segment, or false if the
         *                      write cannot be made in the current tick
         */
        set(k, v) {
            if (v === DELETE_MARK) {
                v = ESCAPED_DELETE_MARK;
            }
            else if (v.length > 0 && v[0] == '\\') {
                v = '\\' + v;
            }
            return this.writeInternal(k, v);
        }
        /**
         * Delete the specified key in the database
         *
         * Note: this method and the {@link set} method can fail. See the {@link set} method for more details
         *
         * @param {string} k - the key to delete
         * @returns {boolean} - whether or not the write has been successfully recorded
         */
        delete(k) {
            return this.writeInternal(k, DELETE_MARK);
        }
        requestCheckpoint() {
            if (this.checkpointing === null) {
                this.checkpointing = '';
            }
        }
        requestMerge() {
            if (this.merging === null) {
                this.merging = '';
            }
        }
        requestCompact() {
            if (this.compacting === null) {
                this.compacting = '';
            }
        }
        writeInternal(k, v) {
            if (!this.writing) {
                return false;
            }
            if (this.estimatedWritingSize + k.length + v.length + 2 >= 100000) {
                return false;
            }
            this.writing.set(k, v);
            this.estimatedWritingSize += k.length + v.length + 2;
            return true;
        }
        /** query the minimal write quota in this tick */
        minimumWriteQuota() {
            var _a;
            return ((_a = this.writing) === null || _a === void 0 ? void 0 : _a.deltaSize) ? 1 : 0;
        }
        /** query the suggested write quota in this tick */
        suggestedWriteQuota() {
            var _a;
            return ((((_a = this.writing) === null || _a === void 0 ? void 0 : _a.deltaSize) ? 1 : 0) +
                (this.checkpoint !== null ? 1 : 0) +
                (this.splitQueue.length ? 2 : 0) +
                (this.merging !== null ? 1 : 0) +
                (this.compacting !== null ? 1 : 0));
        }
        /**
         * List a range of keys
         *
         * This method is a thin wrapper over the {@link list} method, see {@link list} for more details
         *
         * @param {string} start - the inclusive start key to list
         * @param {string} end - the exclusive end key to list
         * @param {(key: string | null, value: string | null) => SegDBListControl | void} cb - the callback for each key
         */
        listRange(start, end, cb) {
            this.list(start, (key, value) => {
                if (key === null || value === null) {
                    return cb(key, value);
                }
                if (key >= end) {
                    cb(null, null);
                    return SegDBListControl.Stop;
                }
                return cb(key, value);
            });
        }
        /**
         * List a set of keys under a shared prefix
         *
         * This method is a thin wrapper over the {@link list} method, see {@link list} for more details
         *
         * @param {string} prefix - the prefix to request
         * @param {(key: string | null, value: string | null) => SegDBListControl | void} cb - the callback for each key
         */
        listPrefix(prefix, cb) {
            this.list(prefix, (key, value) => {
                if (key === null || value === null) {
                    return cb(key, value);
                }
                if (!key.startsWith(prefix)) {
                    cb(null, null);
                    return SegDBListControl.Stop;
                }
                return cb(key, value);
            });
        }
        /**
         * List key-value pairs in the database
         *
         * Thanks to the range partition design, the list operation is possible and the keys yielded can always in order.
         * The callback parameter {@link cb} will be used to accept the output key value pairs. The callback can use its
         * return value to control the list operation. It can return `Stop` to stop the operation, `Yield` to pause the
         * operation and delay it to next tick, or `Continue` to get next key-value pairs. When there is no more keys too
         * be listed, the callback will be called with `cb(null, null)`. In that case no matter what the callback returns
         * the list operation will halt. Also the list may pause even if the callback returns continue, if the hosting
         * segment is not yet loaded.
         *
         * @param {string} start - the key to start listing
         * @param {(key: string | null, value: string | null) => SegDBListControl | void} cb - the callback
         */
        list(start, cb) {
            const req = {
                key: start,
                cb,
                proc: null,
            };
            req.proc = this.listProc(req);
            const ret = req.proc.next();
            if (ret.done) {
                req.proc = null;
            }
            else {
                this.listRequests.push(req);
            }
        }
        *listProc(req) {
            var _a;
            while (true) {
                let ctrl = SegDBListControl.Continue;
                if (!this.writing) {
                    yield;
                    continue;
                }
                const part = SegDB.getPartitionForKey(req.key);
                const loadedSegment = this.segments.get(part.seg);
                if (!loadedSegment) {
                    yield;
                    continue;
                }
                const writingKeys = [...this.writing.keys()]
                    .filter(k => k >= req.key && (part.high === null || part.high > k))
                    .sort();
                const segKeys = [...loadedSegment.keys()].filter(k => k >= req.key).sort();
                let wIdx = 0;
                let sIdx = 0;
                while (wIdx != writingKeys.length || sIdx != segKeys.length) {
                    let value;
                    if (wIdx != writingKeys.length && sIdx != segKeys.length) {
                        if (segKeys[sIdx] == writingKeys[wIdx]) {
                            req.key = segKeys[sIdx];
                            value = loadedSegment.get(req.key);
                            ++sIdx;
                            ++wIdx;
                        }
                        else if (segKeys[sIdx] < writingKeys[wIdx]) {
                            req.key = segKeys[sIdx];
                            value = loadedSegment.get(req.key);
                            ++sIdx;
                        }
                        else {
                            req.key = writingKeys[wIdx];
                            value = this.writing.get(req.key);
                            ++wIdx;
                        }
                    }
                    else if (wIdx != writingKeys.length) {
                        req.key = writingKeys[wIdx];
                        value = this.writing.get(req.key);
                        ++wIdx;
                    }
                    else {
                        req.key = segKeys[sIdx];
                        value = loadedSegment.get(req.key);
                        ++sIdx;
                    }
                    if (value == DELETE_MARK) {
                        continue;
                    }
                    ctrl = (_a = req.cb(req.key, value)) !== null && _a !== void 0 ? _a : SegDBListControl.Continue;
                    if (ctrl == SegDBListControl.Stop) {
                        req.cb(null, null);
                        return;
                    }
                    if (ctrl == SegDBListControl.Yield) {
                        break;
                    }
                }
                if (wIdx != writingKeys.length && sIdx != segKeys.length) {
                    req.key = segKeys[sIdx] <= writingKeys[wIdx] ? segKeys[sIdx] : writingKeys[wIdx];
                }
                else if (sIdx != segKeys.length) {
                    req.key = segKeys[sIdx];
                }
                else if (wIdx != writingKeys.length) {
                    req.key = writingKeys[wIdx];
                }
                else {
                    // partition border
                    if (part.high == null) {
                        // invoke the callback even if the control is yield
                        req.cb(null, null);
                        return;
                    }
                    req.key = part.high;
                }
                if (ctrl === SegDBListControl.Yield) {
                    yield;
                }
            }
        }
        checkpoint(writeQuotaForPartitions, cpuLimit) {
            if (!this.writing || this.checkpointing === null || !writeQuotaForPartitions) {
                return writeQuotaForPartitions;
            }
            const keys = [...this.writing.keys()].sort();
            while (Game.cpu.getUsed() <= cpuLimit && writeQuotaForPartitions && this.checkpointing !== null) {
                const part = SegDB.getPartitionForKey(this.checkpointing);
                const keysToCheckPoint = keys.filter(k => part.low <= k && (part.high === null || part.high > k));
                if (keysToCheckPoint.length == 0) {
                    this.checkpointing = part.high;
                    continue;
                }
                const loadedSegment = this.segments.get(part.seg);
                for (const k of keysToCheckPoint) {
                    const v = this.writing.get(k);
                    if (v == DELETE_MARK) {
                        loadedSegment.delete(k);
                    }
                    else if (v == ESCAPED_DELETE_MARK) {
                        loadedSegment.set(k, DELETE_MARK);
                    }
                    else if (v.length > 0 && v[0] === '\\') {
                        loadedSegment.set(k, v.substring(1));
                    }
                    else {
                        loadedSegment.set(k, v);
                    }
                }
                const partitionSerialized = loadedSegment.write(this.config.segmentMergeThreshold);
                if (partitionSerialized && partitionSerialized.length > 100000) {
                    this.splitQueue.push(part.seg);
                    break;
                }
                if (partitionSerialized !== null) {
                    if (partitionSerialized.length >= this.config.splitThreshold) {
                        this.splitQueue.push(part.seg);
                    }
                    RawMemory.segments[part.seg] = partitionSerialized;
                    --writeQuotaForPartitions;
                }
                for (const k of keysToCheckPoint) {
                    this.writing.delete(k);
                }
                this.checkpointing = part.high;
            }
            if (this.checkpointing === null) {
                const writingSerialized = this.writing.write(0 /* forceCompact */);
                if (writingSerialized !== null) {
                    RawMemory.segments[Memory.segdb.writing] = writingSerialized;
                    this.estimatedWritingSize = writingSerialized.length;
                }
            }
            return writeQuotaForPartitions;
        }
        split(writeQuotaForPartitions, cpuLimit) {
            while (Game.cpu.getUsed() <= cpuLimit && this.splitQueue.length && writeQuotaForPartitions >= 2) {
                let allocated = -1;
                if (Memory.segdb.freedSegments.length) {
                    allocated = Memory.segdb.freedSegments.pop();
                }
                else if (Memory.segdb.allocateBegin != Memory.segdb.allocateLimit) {
                    allocated = Memory.segdb.allocateBegin++;
                }
                if (allocated == -1) {
                    return writeQuotaForPartitions;
                }
                writeQuotaForPartitions -= 2;
                this.splitPartition(this.splitQueue.shift(), allocated, 0.5);
            }
            if (this.splitQueue.length == 0) {
                this.merging = '';
            }
            return writeQuotaForPartitions;
        }
        splitPartition(seg, newSeg, leftRatio) {
            const loadedSegment = this.segments.get(seg);
            if (!loadedSegment) {
                return;
            }
            const partToSplit = Memory.segdb.partitions.find(p => p.seg == seg);
            if (!partToSplit) {
                return;
            }
            const totalLength = loadedSegment.lastSerializedLength;
            const leftSizeLimit = totalLength * leftRatio;
            const keys = [...loadedSegment.keys()].sort();
            let splitKey = null;
            let leftSize = 0;
            for (const k of keys) {
                const v = loadedSegment.get(k);
                leftSize += k.length + v.length + 2;
                if (leftSize >= leftSizeLimit) {
                    splitKey = k;
                    break;
                }
            }
            if (!splitKey) {
                return;
            }
            const newSegment = SegDB.createAppendMergeSegment('');
            for (const k of keys) {
                if (k >= splitKey) {
                    break;
                }
                const v = loadedSegment.get(k);
                newSegment.set(k, v);
                loadedSegment.delete(k);
            }
            const oldSerialized = loadedSegment.write(0 /* forceCompact */);
            if (oldSerialized !== null) {
                RawMemory.segments[seg] = oldSerialized;
            }
            const newSerialized = newSegment.write(this.config.segmentMergeThreshold);
            if (newSerialized !== null) {
                RawMemory.segments[newSeg] = newSerialized;
            }
            this.segments.set(newSeg, newSegment);
            Memory.segdb.partitions.push({
                low: partToSplit.low,
                high: splitKey,
                seg: newSeg,
            });
            partToSplit.low = splitKey;
        }
        merge(writeQuotaForPartitions, cpuLimit) {
            while (Game.cpu.getUsed() <= cpuLimit && this.merging !== null && writeQuotaForPartitions) {
                const part = SegDB.getPartitionForKey(this.merging);
                if (part.high === null) {
                    this.merging = null;
                    break;
                }
                const nextPart = SegDB.getPartitionForKey(part.high);
                const loadedSegment = this.segments.get(part.seg);
                const nextLoadedSegment = this.segments.get(nextPart.seg);
                if (!loadedSegment || !nextLoadedSegment) {
                    return writeQuotaForPartitions;
                }
                if (loadedSegment.lastSerializedLength + nextLoadedSegment.lastSerializedLength <=
                    this.config.mergeThreshold) {
                    --writeQuotaForPartitions;
                    this.mergePartitions(part, nextPart, loadedSegment, nextLoadedSegment);
                    this.merging = nextPart.high;
                }
                else {
                    this.merging = part.high;
                }
            }
            if (this.merging === null &&
                this.segments.size >=
                    this.config.compactThresholdRatio *
                        (Memory.segdb.partitions.length +
                            Memory.segdb.allocateLimit -
                            Memory.segdb.allocateBegin +
                            Memory.segdb.freedSegments.length)) {
                this.compacting = '';
            }
            return writeQuotaForPartitions;
        }
        mergePartitions(leftPart, rightPart, leftSegment, rightSegment) {
            for (const [k, v] of rightSegment.entries()) {
                leftSegment.set(k, v);
            }
            const leftSerialized = leftSegment.write(0 /* forceCompact */);
            if (leftSerialized) {
                RawMemory.segments[leftPart.seg] = leftSerialized;
            }
            leftPart.high = rightPart.high;
            Memory.segdb.freedSegments.push(rightPart.seg);
            Memory.segdb.partitions.splice(Memory.segdb.partitions.findIndex(p => p.seg == rightPart.seg), 1);
            this.segments.delete(rightPart.seg);
        }
        compact(writeQuotaForPartitions, cpuLimit) {
            while (Game.cpu.getUsed() <= cpuLimit && this.compacting !== null && writeQuotaForPartitions >= 2) {
                const part = SegDB.getPartitionForKey(this.compacting);
                if (part.high === null) {
                    this.compacting = null;
                    break;
                }
                const nextPart = SegDB.getPartitionForKey(part.high);
                const loadedSegment = this.segments.get(part.seg);
                const nextLoadedSegment = this.segments.get(nextPart.seg);
                if (!loadedSegment || !nextLoadedSegment) {
                    return writeQuotaForPartitions;
                }
                if (loadedSegment.lastSerializedLength + nextLoadedSegment.lastSerializedLength <=
                    this.config.compactTarget) {
                    --writeQuotaForPartitions;
                    this.mergePartitions(part, nextPart, loadedSegment, nextLoadedSegment);
                }
                else if (loadedSegment.lastSerializedLength <= this.config.compactTarget) {
                    writeQuotaForPartitions -= 2;
                    this.rebalancePartitions(part, nextPart, loadedSegment, nextLoadedSegment);
                }
                this.compacting = part.high;
            }
            return writeQuotaForPartitions;
        }
        rebalancePartitions(leftPart, rightPart, leftSegment, rightSegment) {
            let leftSize = leftSegment.lastSerializedLength;
            const rightKeys = [...rightSegment.keys()].sort();
            if (rightKeys.length == 0) {
                this.mergePartitions(leftPart, rightPart, leftSegment, rightSegment);
                return;
            }
            let newSplitKey = null;
            for (const k of rightKeys) {
                const v = rightSegment.get(k);
                leftSize += k.length + v.length + 2;
                if (leftSize >= this.config.compactTarget) {
                    break;
                }
                newSplitKey = k;
            }
            if (!newSplitKey || newSplitKey === rightKeys[0]) {
                return;
            }
            for (const k of rightKeys) {
                if (k >= newSplitKey) {
                    break;
                }
                const v = rightSegment.get(k);
                leftSegment.set(k, v);
                rightSegment.delete(k);
            }
            const leftSerialized = leftSegment.write(0 /* forceCompact */);
            if (leftSerialized !== null) {
                RawMemory.segments[leftPart.seg] = leftSerialized;
            }
            const rightSerialized = rightSegment.write(0 /* forceCompact */);
            if (rightSerialized !== null) {
                RawMemory.segments[rightPart.seg] = rightSerialized;
            }
            leftPart.high = newSplitKey;
            rightPart.low = newSplitKey;
        }
        static getPartitionForKey(k) {
            return Memory.segdb.partitions.find(p => p.low <= k && (p.high === null || p.high > k));
        }
        static getPartitionSegForKey(k) {
            return SegDB.getPartitionForKey(k).seg;
        }
        static deserializeString(s) {
            const split = [...(0, append_merge_segment_1.SplitAndUnescape)(s, '=')];
            if (split[1] == '') {
                return [split[0], null];
            }
            return split;
        }
        static serializeString(k, v) {
            if (v == null) {
                v = '';
            }
            return (0, append_merge_segment_1.EscapeAndJoin)([k, v], '=');
        }
        static createAppendMergeSegment(lastSerialized) {
            return new append_merge_segment_1.AppendMergeSegment('|', lastSerialized, this.deserializeString, this.serializeString);
        }
    }
    exports.SegDB = SegDB;
});
