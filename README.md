# SegDB

The SegDB is a key-value database designed for the programming MMORTS game [Screeps: World](https://screeps.com/). It
can utilize the segments provided by the game, to gain access to the extra 10MB memory space. The database stores
key-value pairs in strings across multiple segments, so you, as the user don't need to worry about the size limitation
of individual segments. The database provides `get`, `set` and `delete` to operate a single key, and a few `list`
methods to list a set of key-value pairs in lexicographical order.

## Usage

If you use TypeScript, you can grab the `segdb.ts` and `append_merge_segment.ts` from the `src` folder to your codebase
and import them. If you use JavaScript, you can turn to the `segdb.js` and `append_merge_segment.js` under the
`dist/src` folder.

### Setup

You should create only one instance of the `SegDB` object. And check the existence of the `Memory.segdb` to determine
whether or not the db has been setup. If not, use the `resetOnRespawn()` to specify a range of segments for the database
to use exclusively. Then on every tick, you should call `tickStart()` at convenience time, to trigger callback for
pending read requests if their hosting segment got loaded. And lastly, you should call `tickAfter()` so the database can
finish its housekeeping work. If you make any update to the database in this tick, you'd better to reserve at least 1
write quota for the database. The database can work if you don't give it any write quota, but if the global reset
happens right on this tick, you may lose some changes. You can use `minimumWriteQuota()` to query the minimum write
quota or `suggtestedWriteQuota` for the suggested one.

**Note**
The SegDB would use a few kilo-bytes vanilla Memory to store some metadata. The memory path is hardcoded as
`Memory.segdb`. So be careful to potential name conflict.

```typescript 

import { SegDB } from './path/to/segdb';
export const db = new SegDB();

function loop() {
    if (!Memory.segdb) {
        // setup the metadata in Memory.segdb, give it a range of segments to allocate
        db.resetOnRespawn(10 /* allocateBegin */, 100 /* allocateLimit */);
    }

    // the `tickStart` will do the first half of the housekeeping work
    db.tickStart();

    // other logic

    // the `tickAfter` will do the rest of the housekeeping work
    db.tickAfter(
        [] /* a list of unmanaged segment ids that other components in your bot request to access */,
        10 /* the number of segments can SegDB update this tick */,
        Math.max(Game.cpu.limit, Game.cpu.getUsed() + 5) /* the cpu limit for the SegDB */,
    );
}

```

### Query

```typescript
// `set` should be used to set value to a key
// Note the set or any write operations can fail in some situation, but once the writing methods return `true` and there
// is at least 1 write quota when calling `tickAfter`, the writes are then guarenteed to be persisted
let res = db.set('key1', 'value1');
if (!res) {
    // handle set failure
}

res = db.set('key2', 'value2');
if (!res) {
    // handle set failure
}

// `get` can be used to retrieve values asynchronously
// After a few ticks the callback will probably be called instantly before the `get` returns, but if the segments are not
// ready yet, the callback may be delayed by a few ticks.
db.get('key1', (v: string | undefined, k: string) => {
    assert.equal(v, 'value1');
    assert.equal(k, 'key1');
});

// `tryGet` can be used to retrieve values in a non-blocking manner
// `undefined` will be returned if the key is not found, and `false` will be returned if the underlying segments are not
// ready
const value2 = db.tryGet('key2');
assert.strictEqual(value2, 'value2');

const value3 = db.tryGet('key3');
assert.strictEqual(value3, undefined);

// `delete` can be used to delete keys in the database
// Just like the `set`, delete can fail as well
res = db.delete('key1');
if (!res) {
    // handle delete failure
}

const value1 = db.tryGet('key1');
assert.strictEqual(value1, undefined);

// `list` can be used to retrieve a set of key-value pairs in lexicographical order
const listed: [string, string][] = [];
db.list('' /* start */, (k: string | null, v: string | null) => {
    if (k === null || v === null) {
        // k or v become `null` to notify the list is finished
        assert.deepEqual(listed, [
            ['key2', 'value2'],
            ['key3', 'value3']
        ]);

        return;
    }

    listed.push([k, v]);

    // you can also choose to return explicitly SegDBListControl.{Continue, Stop, Yield} to control the list
    // the default behavior is SegDBListControl.Continue
});
```

## Design

```text


              Updates
                |
                V
 +--------------------------------------+
 | Writing Segment                      |
 +--------------------------------------+
                |
            Checkpoint
                |
                V
 Partition Segments:
 +--------------------------------------+       <--\
 | ['', 'a')                            |           |
 |--------------------------------------|           |
 | ['a', 'c')                           |           |
 |--------------------------------------|       Rebalance
 | ['c', 'z')                           |           |
 |--------------------------------------|           |
 | ['z', MAX)                           |           |
 +--------------------------------------+       <--/

```

### Range Based Partition

The basic idea of the SegDB is to make most of the segments as partitions. And each partition manages a range of keys.
The ranges managed by partitions will not overlap with each other, and when joining all ranges, you will always get a
full [MIN, MAX) space. The MIN here is `''`, the empty string, and the MAX is the `null`. Initially we only have one
partition, whose range is [MIN, MAX). As more and more writes come in, the partition will grow larger and larger. When
its size approaches the segment size limit, we split the partition into two. And on the other hand if massive deletes
come in and two adjacent partitions are both small enough, we merge them back into one to reduce segments count.

To overcome the limit on the number of segments we can update in each tick, SegDB uses a dedicated segment as the
writing segment. All updates, no matter `set` or `delete`, goes into that segment first. So most of the time we only
need to update one segment. And when the writing segment grows too large, we trigger a `checkpoint` operation, to
consolidate updates in the writing segment back to each partition segments.

The good part of the range based partition design is that we can easily support list, especially ranged list, which is
very useful as we probably want to store everything into this single database. And the most intuitive solution is to
separate them by prefixes in the keys. For example both feature A and feature B need to store info in the database, and
things in the feature A can use keys like `A.something_important` and things in B can use `B.something_important`. In
that case, being able to list everything in `A` or `B` looks like a great idea.

### Rebalance Operations

There can be three kinds of rebalance operations involved: `split`, `merge`, and `compact`. They will be triggered
automatically when needed.

The `split` will split a large enough partition into two partitions:

```text
Before:
+-----------------------------------+
| ['a', 'c')                        | 
+-----------------------------------+

After
+-----------------------------------+
| ['a', 'b')                        |
|-----------------------------------|
| ['b', 'c')                        |
+-----------------------------------+
```

The `merge` will revert a `split`, merge two small enough partitions back into one:

```text
Before:
+-----------------------------------+
| ['a', 'b')                        |
|-----------------------------------|
| ['b', 'c')                        |
+-----------------------------------+

After
+-----------------------------------+
| ['a', 'c')                        | 
+-----------------------------------+
```

While the `compact` will adjust the boundary of two adjacent partitions, to make the sizes of both reasonable:

```text
Before:
+-----------------------------------+
| ['a', 'b')                        |
|-----------------------------------|
| ['b', 'z')                        |
+-----------------------------------+

After
+-----------------------------------+
| ['a', 'f')                        |
|-----------------------------------|
| ['f', 'z')                        |
+-----------------------------------+
```

**Note**
All of the rebalancing operations are triggered by updates. If there is not updates in the first place, it is guarenteed
that no rebalancing operations will happen.

### AppendMergeSegment

Below the partition and the writing design, there is a lower level structure called `AppendMergeSegment` supporting the
whole database. The `AppendMergeSegment` is a helper class for managing a single segment. The key idea of this class is,
we maintain two layers of `Map` in the memory, the base layer and the delta layer, together with the last serialized
string. When there are `set`s, we put them in the delta layer. And when there are `delete`s, we put a delete mark in the
delta layer. At the time when we need to serialize to the `RawMemory.segments`, we only need to serialize those in the
delta layer, and append the serialized delta to the end of the last serialized string, and make it as the final result
after merging the delta into the base. In that way we can minimize the cost of serialization, as we don't need to
serialize everything every tick. In the end, if the serialized string become too long, we merge delta to base and
serialize all the entries the base again as the new result, to clean up all duplicated or deleted entries in the
serialized form.

The `AppendMergeSegment` acts like a `Map`, and it will maintain a memory cache of all the entries in the segment. It is
also exported for you to use. 

## API Reference

### SegDB

```typescript
export enum SegDBListControl {
    Stop = 0,
    Yield = 1,
    Continue = 2,
}

export interface SegDBConfig {
    /** threshold to trigger AppendMergeSegment compact, see {@link AppendMergeSegment} for details */
    segmentMergeThreshold: number;

    /** when the writing segment size goes above this value, we trigger a checkpoint */
    writingThresholdToCheckPoint: number;

    /** when a partition segment size goes above this value, we trigger a split on that partition */
    splitThreshold: number;

    /** when a partition segment size plus its right neighbor's size go below this value, we trigger a merge for those 2 partitions */
    mergeThreshold: number;

    /** when total partition count goes above this ratio, we trigger a compact */
    compactThresholdRatio: number;

    /** during compact, we will try to move key-value pairs from the right neighbors, to make sure the partition sizes
     * go close, but not above this value, to reduce the overall partition count */
    compactTarget: number;
}

export class SegDB {
    /**
     * @constructor
     * @param {Partial<SegDBConfig>} conf - see {@link SegDBConfig} for details
     */
    constructor(conf?: Partial<SegDBConfig>);

    /**
     * Initialize the Memory structure for the SegDB
     *
     * @param {number} allocateBegin - the start of the segment ids for the db to allocate
     * @param {number} allocateLimit - the limit of the segment ids for the db to allocate
     */
    resetOnRespawn(allocateBegin: number, allocateLimit: number);


    /**
     * The first half of the tick work, collect the loaded segments and trigger callback for pending requests
     */
    tickStart();

    /**
     * The second half of the tick work, serialize pending write, and handle load balancing operations
     *
     * @param {number[]} readingSegments - segment read requests from other components
     * @param {number} writeQuota - max number of segments this method can update in this tick
     * @param {number} cpuLimit - a timepoint to halt the load balancing operation
     */
    tickAfter(readingSegments: number[], writeQuota: number, cpuLimit: number);

    /** A helper method to call {@link tickStart} and {@link tickAfter} */
    tick(readingSegments: number[], writeQuota: number, cpuLimit: number);

    /** Get current stats of the db */
    getStats(): { totalLength: number; segments: number; writingLength: number; spaceLimit: number } | null;

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
    tryGet(k: string): false | undefined | string;

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
    get(k: string, cb: (v: string | undefined, k: string) => void): boolean;

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
    set(k: string, v: string): boolean;

    /**
     * Delete the specified key in the database
     *
     * Note: this method and the {@link set} method can fail. See the {@link set} method for more details
     *
     * @param {string} k - the key to delete
     * @returns {boolean} - whether or not the write has been successfully recorded
     */
    delete(k: string): boolean;

    requestCheckpoint();
    requestMerge();
    requestCompact();

    /** query the minimal write quota in this tick */
    minimumWriteQuota(): number;

    /** query the suggested write quota in this tick */
    suggestedWriteQuota(): number;

    /**
     * List a range of keys
     *
     * This method is a thin wrapper over the {@link list} method, see {@link list} for more details
     *
     * @param {string} start - the inclusive start key to list
     * @param {string} end - the exclusive end key to list
     * @param {(key: string | null, value: string | null) => SegDBListControl | void} cb - the callback for each key
     */
    listRange(start: string, end: string, cb: (key: string | null, value: string | null) => SegDBListControl | void);

    /**
     * List a set of keys under a shared prefix
     *
     * This method is a thin wrapper over the {@link list} method, see {@link list} for more details
     *
     * @param {string} prefix - the prefix to request
     * @param {(key: string | null, value: string | null) => SegDBListControl | void} cb - the callback for each key
     */
    listPrefix(prefix: string, cb: (key: string | null, value: string | null) => SegDBListControl | void);

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
    list(start: string, cb: (key: string | null, value: string | null) => SegDBListControl | void);
}
```

### AppendMergeSegment

```typescript
export class AppendMergeSegment<T> {
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
    constructor(
        delim: string,
        lastSerialized: string,
        deserialize: (s: string) => [string, T | null],
        serialize: (k: string, v: T | null) => string,
    );

    /**
     * Get the value of the given key in the segment
     *
     * @param {string} k - The key to get
     * @returns {T | undefined} - The value associated with the key, or undefined if not found
     */
    get(k: string): T | undefined;

    /**
     * Set the value of the given key in the segment
     *
     * @param {string} k - The key to get
     * @param {T} v - The value to be associated with the key
     */
    set(k: string, v: T);

    /**
     * Delete the given key in the segment
     *
     * @param {string} k - The key to get
     */
    delete(k: string);

    /**
     * @returns {number} - the number of keys at the last write, not including the updates made later
     */
    get size(): number;

    /**
     * @returns {number} - the number of updates made after last write
     */
    get deltaSize(): number;

    /**
     * @returns {number} - the serialized length at the last write
     */
    get lastSerializedLength(): number;

    /**
     * @returns {Generator<string>} - a generator to go through all keys that are set, but not deleted in the segment,
     *                                in random order
     */
    *keys(): Generator<string>;

    /**
     * @returns {Generator<[string, T]>} - a generator to go through all entities, whose keys are set, but not deleted
     *                                     in the segment, in random order
     */
    *entries(): Generator<[string, T]>;

    /**
     * Iterate key-value pairs in the segment, and delete some of them
     *
     * @param {(k: string, v: T) => boolean} cb - A callback, return true to delete the current key
     */
    removeIf(cb: (k: string, v: T) => boolean);

    /**
     * Serialize the content of the segment
     *
     * @param {number} compactLimit - If the serialized length is larger than the compactLimit, we trigger a compaction
     * @returns {string | null} - The serialized segment content, or null if there is no update
     */
    write(compactLimit: number): string | null;
}
```
