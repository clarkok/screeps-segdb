import { assert } from 'chai';
import { AppendMergeSegment, EscapeAndJoin, SplitAndUnescape } from '../src/append_merge_segment';

describe('SplitAndUnescape', () => {
    it('should split', function () {
        assert.deepEqual(['a', 'b', 'c'], [...SplitAndUnescape('a|b|c', '|')]);
        assert.deepEqual(['a', 'b', ''], [...SplitAndUnescape('a|b|', '|')]);
    });
    it('should unescape', function () {
        assert.deepEqual(['a', 'b', 'c'], [...SplitAndUnescape('\\a|b|c', '|')]);
        assert.deepEqual(['a', 'b', 'c'], [...SplitAndUnescape('a|\\b|c', '|')]);
        assert.deepEqual(['a', 'b', 'c'], [...SplitAndUnescape('a|b|\\c', '|')]);
        assert.deepEqual(['a', 'b', '\\'], [...SplitAndUnescape('a|b|\\\\', '|')]);
    });
    it('should parse delimiter', function () {
        assert.deepEqual(['|a', 'b', 'c'], [...SplitAndUnescape('\\|a|b|c', '|')]);
        assert.deepEqual(['a', '|b', 'c'], [...SplitAndUnescape('a|\\|b|c', '|')]);
        assert.deepEqual(['a', 'b', '|c'], [...SplitAndUnescape('a|b|\\|c', '|')]);
        assert.deepEqual(['a|', 'b', 'c'], [...SplitAndUnescape('a\\||b|c', '|')]);
        assert.deepEqual(['a', 'b|', 'c'], [...SplitAndUnescape('a|b\\||c', '|')]);
        assert.deepEqual(['a', 'b', 'c|'], [...SplitAndUnescape('a|b|c\\|', '|')]);
    });
    it('can handle multiple parts', function () {
        assert.deepEqual(['ab|c\\d'], [...SplitAndUnescape('a\\b\\|\\c\\\\d', '|')]);
    });
});

describe('EscapeAndJoin', () => {
    it('should escape', function () {
        assert.equal('\\\\', EscapeAndJoin(['\\'], '|'));
        assert.equal('\\|', EscapeAndJoin(['|'], '|'));
    });
    it('should join', function () {
        assert.equal('a|b|c', EscapeAndJoin(['a', 'b', 'c'], '|'));
        assert.equal('a|b|', EscapeAndJoin(['a', 'b', ''], '|'));
    });
    it('should work with SplitAndUnescape', function () {
        assert.deepEqual(['a', 'b', 'c'], [...SplitAndUnescape(EscapeAndJoin(['a', 'b', 'c'], '|'), '|')]);
        assert.deepEqual(['\\', 'b', 'c'], [...SplitAndUnescape(EscapeAndJoin(['\\', 'b', 'c'], '|'), '|')]);
        assert.deepEqual(['a', 'b\\', 'c'], [...SplitAndUnescape(EscapeAndJoin(['a', 'b\\', 'c'], '|'), '|')]);
        assert.deepEqual(['a', 'b', '|'], [...SplitAndUnescape(EscapeAndJoin(['a', 'b', '|'], '|'), '|')]);
        assert.deepEqual(['a', 'b', '|\\'], [...SplitAndUnescape(EscapeAndJoin(['a', 'b', '|\\'], '|'), '|')]);
        assert.deepEqual(['a', 'a|b', '|'], [...SplitAndUnescape(EscapeAndJoin(['a', 'a|b', '|'], '|'), '|')]);
        assert.deepEqual(['a', 'b\\b', '|'], [...SplitAndUnescape(EscapeAndJoin(['a', 'b\\b', '|'], '|'), '|')]);
    });
});

describe('AppendMergeSegment', () => {
    function Deserialize(s: string): [string, string | null] {
        const split = [...SplitAndUnescape(s, ':')] as [string, string];
        if (split[1] === 'null') {
            return [split[0], null];
        }
        return split;
    }

    function Serialize(k: string, v: string | null) {
        return EscapeAndJoin([k, v ?? 'null'], ':');
    }

    it('should set and get', function () {
        const uut = new AppendMergeSegment<string>('|', '', Deserialize, Serialize);

        uut.set('a', 'a');
        uut.set('b', 'b');

        assert.equal('a', uut.get('a'));
        assert.equal('b', uut.get('b'));
        assert.equal(undefined, uut.get('c'));
    });
    it('should initialize from segment', function () {
        const uut = new AppendMergeSegment<string>('|', 'a:a|b:b', Deserialize, Serialize);

        assert.equal('a', uut.get('a'));
        assert.equal('b', uut.get('b'));
        assert.equal(undefined, uut.get('c'));
    });
    it('should write delta', function () {
        const uut = new AppendMergeSegment<string>('|', '', Deserialize, Serialize);

        assert.equal(null, uut.write(100));

        uut.set('a', 'a');
        uut.set('b', 'b');
        uut.set('c', 'c');
        uut.set('d', 'd');

        assert.equal('a:a|b:b|c:c|d:d', uut.write(100));

        assert.equal('a', uut.get('a'));
        assert.equal('b', uut.get('b'));
        assert.equal(undefined, uut.get('e'));

        assert.equal(null, uut.write(100));

        uut.set('a', 'b');

        assert.equal('a:a|b:b|c:c|d:d|a:b', uut.write(100));

        assert.equal('b', uut.get('a'));
        assert.equal('b', uut.get('b'));
        assert.equal(undefined, uut.get('e'));
    });
    it('should write deletes', function () {
        const uut = new AppendMergeSegment<string>('|', 'a:a|b:b', Deserialize, Serialize);

        assert.equal('a', uut.get('a'));
        assert.equal('b', uut.get('b'));
        assert.equal(undefined, uut.get('c'));

        uut.delete('a');
        assert.equal('a:a|b:b|a:null', uut.write(100));

        assert.equal(undefined, uut.get('a'));
    });
});
