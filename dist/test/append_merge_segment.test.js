(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "chai", "../src/append_merge_segment"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    const chai_1 = require("chai");
    const append_merge_segment_1 = require("../src/append_merge_segment");
    describe('SplitAndUnescape', () => {
        it('should split', function () {
            chai_1.assert.deepEqual(['a', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|b|c', '|')]);
            chai_1.assert.deepEqual(['a', 'b', ''], [...(0, append_merge_segment_1.SplitAndUnescape)('a|b|', '|')]);
        });
        it('should unescape', function () {
            chai_1.assert.deepEqual(['a', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('\\a|b|c', '|')]);
            chai_1.assert.deepEqual(['a', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|\\b|c', '|')]);
            chai_1.assert.deepEqual(['a', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|b|\\c', '|')]);
            chai_1.assert.deepEqual(['a', 'b', '\\'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|b|\\\\', '|')]);
        });
        it('should parse delimiter', function () {
            chai_1.assert.deepEqual(['|a', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('\\|a|b|c', '|')]);
            chai_1.assert.deepEqual(['a', '|b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|\\|b|c', '|')]);
            chai_1.assert.deepEqual(['a', 'b', '|c'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|b|\\|c', '|')]);
            chai_1.assert.deepEqual(['a|', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('a\\||b|c', '|')]);
            chai_1.assert.deepEqual(['a', 'b|', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|b\\||c', '|')]);
            chai_1.assert.deepEqual(['a', 'b', 'c|'], [...(0, append_merge_segment_1.SplitAndUnescape)('a|b|c\\|', '|')]);
        });
        it('can handle multiple parts', function () {
            chai_1.assert.deepEqual(['ab|c\\d'], [...(0, append_merge_segment_1.SplitAndUnescape)('a\\b\\|\\c\\\\d', '|')]);
        });
    });
    describe('EscapeAndJoin', () => {
        it('should escape', function () {
            chai_1.assert.equal('\\\\', (0, append_merge_segment_1.EscapeAndJoin)(['\\'], '|'));
            chai_1.assert.equal('\\|', (0, append_merge_segment_1.EscapeAndJoin)(['|'], '|'));
        });
        it('should join', function () {
            chai_1.assert.equal('a|b|c', (0, append_merge_segment_1.EscapeAndJoin)(['a', 'b', 'c'], '|'));
            chai_1.assert.equal('a|b|', (0, append_merge_segment_1.EscapeAndJoin)(['a', 'b', ''], '|'));
        });
        it('should work with SplitAndUnescape', function () {
            chai_1.assert.deepEqual(['a', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)((0, append_merge_segment_1.EscapeAndJoin)(['a', 'b', 'c'], '|'), '|')]);
            chai_1.assert.deepEqual(['\\', 'b', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)((0, append_merge_segment_1.EscapeAndJoin)(['\\', 'b', 'c'], '|'), '|')]);
            chai_1.assert.deepEqual(['a', 'b\\', 'c'], [...(0, append_merge_segment_1.SplitAndUnescape)((0, append_merge_segment_1.EscapeAndJoin)(['a', 'b\\', 'c'], '|'), '|')]);
            chai_1.assert.deepEqual(['a', 'b', '|'], [...(0, append_merge_segment_1.SplitAndUnescape)((0, append_merge_segment_1.EscapeAndJoin)(['a', 'b', '|'], '|'), '|')]);
            chai_1.assert.deepEqual(['a', 'b', '|\\'], [...(0, append_merge_segment_1.SplitAndUnescape)((0, append_merge_segment_1.EscapeAndJoin)(['a', 'b', '|\\'], '|'), '|')]);
            chai_1.assert.deepEqual(['a', 'a|b', '|'], [...(0, append_merge_segment_1.SplitAndUnescape)((0, append_merge_segment_1.EscapeAndJoin)(['a', 'a|b', '|'], '|'), '|')]);
            chai_1.assert.deepEqual(['a', 'b\\b', '|'], [...(0, append_merge_segment_1.SplitAndUnescape)((0, append_merge_segment_1.EscapeAndJoin)(['a', 'b\\b', '|'], '|'), '|')]);
        });
    });
    describe('AppendMergeSegment', () => {
        function Deserialize(s) {
            const split = [...(0, append_merge_segment_1.SplitAndUnescape)(s, ':')];
            if (split[1] === 'null') {
                return [split[0], null];
            }
            return split;
        }
        function Serialize(k, v) {
            return (0, append_merge_segment_1.EscapeAndJoin)([k, v !== null && v !== void 0 ? v : 'null'], ':');
        }
        it('should set and get', function () {
            const uut = new append_merge_segment_1.AppendMergeSegment('|', '', Deserialize, Serialize);
            uut.set('a', 'a');
            uut.set('b', 'b');
            chai_1.assert.equal('a', uut.get('a'));
            chai_1.assert.equal('b', uut.get('b'));
            chai_1.assert.equal(undefined, uut.get('c'));
        });
        it('should initialize from segment', function () {
            const uut = new append_merge_segment_1.AppendMergeSegment('|', 'a:a|b:b', Deserialize, Serialize);
            chai_1.assert.equal('a', uut.get('a'));
            chai_1.assert.equal('b', uut.get('b'));
            chai_1.assert.equal(undefined, uut.get('c'));
        });
        it('should write delta', function () {
            const uut = new append_merge_segment_1.AppendMergeSegment('|', '', Deserialize, Serialize);
            chai_1.assert.equal(null, uut.write(100));
            uut.set('a', 'a');
            uut.set('b', 'b');
            uut.set('c', 'c');
            uut.set('d', 'd');
            chai_1.assert.equal('a:a|b:b|c:c|d:d', uut.write(100));
            chai_1.assert.equal('a', uut.get('a'));
            chai_1.assert.equal('b', uut.get('b'));
            chai_1.assert.equal(undefined, uut.get('e'));
            chai_1.assert.equal(null, uut.write(100));
            uut.set('a', 'b');
            chai_1.assert.equal('a:a|b:b|c:c|d:d|a:b', uut.write(100));
            chai_1.assert.equal('b', uut.get('a'));
            chai_1.assert.equal('b', uut.get('b'));
            chai_1.assert.equal(undefined, uut.get('e'));
        });
        it('should write deletes', function () {
            const uut = new append_merge_segment_1.AppendMergeSegment('|', 'a:a|b:b', Deserialize, Serialize);
            chai_1.assert.equal('a', uut.get('a'));
            chai_1.assert.equal('b', uut.get('b'));
            chai_1.assert.equal(undefined, uut.get('c'));
            uut.delete('a');
            chai_1.assert.equal('a:a|b:b|a:null', uut.write(100));
            chai_1.assert.equal(undefined, uut.get('a'));
        });
    });
});
