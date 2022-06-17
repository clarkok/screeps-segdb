(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "chai", "../src/segdb"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    const chai_1 = require("chai");
    const segdb_1 = require("../src/segdb");
    describe('SegDB', function () {
        beforeEach(function () {
            MockedWorld.reset();
        });
        it('should resetOnRespawn', function () {
            const uut = new segdb_1.SegDB();
            {
                uut.resetOnRespawn(0, 10);
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 0,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                const res = uut.set('a', 'aaa');
                chai_1.assert.isTrue(res);
                chai_1.assert.strictEqual('aaa', uut.tryGet('a'));
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                chai_1.assert.strictEqual('aaa', uut.tryGet('a'));
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 5,
                    segments: 1,
                    writingLength: 5,
                    spaceLimit: 900000,
                }, stats);
            }
        });
        it('should reload after global reset', function () {
            let uut = new segdb_1.SegDB();
            uut.resetOnRespawn(0, 10);
            {
                const res = uut.set('a', 'aaa');
                chai_1.assert.isTrue(res);
                chai_1.assert.strictEqual('aaa', uut.tryGet('a'));
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            uut = new segdb_1.SegDB();
            {
                let got = false;
                const res = uut.get('a', (v, k) => {
                    got = true;
                    chai_1.assert.strictEqual('a', k);
                    chai_1.assert.strictEqual('aaa', v);
                });
                chai_1.assert.isFalse(res);
                uut.tick([], 10, 10);
                chai_1.assert.isFalse(got);
                MockedWorld.tick();
                uut.tick([], 10, 10);
                chai_1.assert.isTrue(got);
            }
        });
        it('should checkpoint', function () {
            const uut = new segdb_1.SegDB({ writingThresholdToCheckPoint: 10000 });
            uut.resetOnRespawn(0, 10);
            const keyLength = 5;
            const valueLength = 5;
            const keyCount = Math.ceil(10000 / (keyLength + valueLength + 2)) + 1;
            {
                for (let i = 0; i < keyCount; ++i) {
                    const k = i.toString().padStart(keyLength, ' ');
                    const v = i.toString().padStart(valueLength, ' ');
                    const res = uut.set(k, v);
                    chai_1.assert.isTrue(res);
                }
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                }, stats);
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: keyCount * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
            }
        });
        it('should list', function () {
            const uut = new segdb_1.SegDB({ writingThresholdToCheckPoint: 10000 });
            uut.resetOnRespawn(0, 10);
            const keyLength = 7;
            const valueLength = 5;
            const keyCount = Math.ceil(10000 / (keyLength + valueLength + 2)) + 1;
            {
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                    const v = i.toString().padStart(valueLength, ' ');
                    const res = uut.set(k, v);
                    chai_1.assert.isTrue(res);
                }
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                }, stats);
                const listA = [];
                let listAFinished = false;
                const listB = [];
                let listBFinished = false;
                const listAll = [];
                let listAllFinished = false;
                uut.list('a.', (key, value) => {
                    if (key === null || value === null || !key.startsWith('a.')) {
                        listAFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listA.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                uut.list('b.', (key, value) => {
                    if (key === null || value === null || !key.startsWith('b.')) {
                        listBFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listB.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                uut.list('', (key, value) => {
                    if (key === null || value === null) {
                        listAllFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listAll.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                chai_1.assert.isTrue(listAFinished);
                chai_1.assert.equal(listA.length, keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listA[i][0], k);
                    chai_1.assert.equal(listA[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                chai_1.assert.isTrue(listBFinished);
                chai_1.assert.equal(listB.length, 0);
                chai_1.assert.isTrue(listAllFinished);
                chai_1.assert.equal(listAll.length, keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listAll[i][0], k);
                    chai_1.assert.equal(listAll[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                    const v = i.toString().padStart(valueLength, ' ');
                    const res = uut.set(k, v);
                    chai_1.assert.isTrue(res);
                }
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 2 * keyCount * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                }, stats);
                const listA = [];
                let listAFinished = false;
                const listB = [];
                let listBFinished = false;
                const listAll = [];
                let listAllFinished = false;
                uut.list('a.', (key, value) => {
                    if (key === null || value === null || !key.startsWith('a.')) {
                        listAFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listA.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                uut.list('b.', (key, value) => {
                    if (key === null || value === null || !key.startsWith('b.')) {
                        listBFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listB.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                uut.list('', (key, value) => {
                    if (key === null || value === null) {
                        listAllFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listAll.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                chai_1.assert.isTrue(listAFinished);
                chai_1.assert.equal(listA.length, keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listA[i][0], k);
                    chai_1.assert.equal(listA[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                chai_1.assert.isTrue(listBFinished);
                chai_1.assert.equal(listB.length, keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listB[i][0], k);
                    chai_1.assert.equal(listB[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                chai_1.assert.isTrue(listAllFinished);
                chai_1.assert.equal(listAll.length, 2 * keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listAll[i][0], k);
                    chai_1.assert.equal(listAll[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listAll[i + keyCount][0], k);
                    chai_1.assert.equal(listAll[i + keyCount][1], i.toString().padStart(keyLength - 2, ' '));
                }
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 2 * keyCount * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                const listA = [];
                let listAFinished = false;
                const listB = [];
                let listBFinished = false;
                const listAll = [];
                let listAllFinished = false;
                uut.list('a.', (key, value) => {
                    if (key === null || value === null || !key.startsWith('a.')) {
                        listAFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listA.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                uut.list('b.', (key, value) => {
                    if (key === null || value === null || !key.startsWith('b.')) {
                        listBFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listB.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                uut.list('', (key, value) => {
                    if (key === null || value === null) {
                        listAllFinished = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listAll.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                chai_1.assert.isTrue(listAFinished);
                chai_1.assert.equal(listA.length, keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listA[i][0], k);
                    chai_1.assert.equal(listA[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                chai_1.assert.isTrue(listBFinished);
                chai_1.assert.equal(listB.length, keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listB[i][0], k);
                    chai_1.assert.equal(listB[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                chai_1.assert.isTrue(listAllFinished);
                chai_1.assert.equal(listAll.length, 2 * keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listAll[i][0], k);
                    chai_1.assert.equal(listAll[i][1], i.toString().padStart(keyLength - 2, ' '));
                }
                for (let i = 0; i < keyCount; ++i) {
                    const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                    chai_1.assert.equal(listAll[i + keyCount][0], k);
                    chai_1.assert.equal(listAll[i + keyCount][1], i.toString().padStart(keyLength - 2, ' '));
                }
            }
        });
        it('should list with yield', function () {
            const uut = new segdb_1.SegDB({ writingThresholdToCheckPoint: 10000 });
            uut.resetOnRespawn(0, 10);
            for (let i = 0; i < 100; ++i) {
                uut.set(i.toString().padStart(3, '0'), i.toString());
            }
            let listedCount = 0;
            let listedDone = false;
            uut.list('', (key, value) => {
                if (!key || !value) {
                    listedDone = true;
                    return segdb_1.SegDBListControl.Stop;
                }
                chai_1.assert.equal(key, listedCount.toString().padStart(3, '0'));
                chai_1.assert.equal(value, listedCount.toString());
                ++listedCount;
                return segdb_1.SegDBListControl.Yield;
            });
            chai_1.assert.equal(listedCount, 1);
            for (let i = 2; i < 100; ++i) {
                uut.tick([], 10, 10);
                MockedWorld.tick();
                chai_1.assert.equal(listedCount, i);
                chai_1.assert.isFalse(listedDone);
            }
            uut.tick([], 10, 10);
            MockedWorld.tick();
            chai_1.assert.equal(listedCount, 100);
            chai_1.assert.isTrue(listedDone);
        });
        it('should delete', function () {
            const uut = new segdb_1.SegDB();
            uut.resetOnRespawn(0, 10);
            {
                const res = uut.set('a', 'a');
                chai_1.assert.isTrue(res);
                uut.requestCheckpoint();
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 3,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                chai_1.assert.strictEqual('a', uut.tryGet('a'));
                uut.delete('a');
                chai_1.assert.strictEqual(undefined, uut.tryGet('a'));
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 6,
                    segments: 1,
                    writingLength: 3,
                    spaceLimit: 900000,
                }, stats);
                chai_1.assert.strictEqual(undefined, uut.tryGet('a'));
                uut.requestCheckpoint();
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 0,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                chai_1.assert.strictEqual(undefined, uut.tryGet('a'));
            }
        });
        it('should split', function () {
            const uut = new segdb_1.SegDB({
                segmentMergeThreshold: 1000,
                writingThresholdToCheckPoint: 1000,
                splitThreshold: 1000,
                mergeThreshold: 1000,
            });
            uut.resetOnRespawn(0, 10);
            const keyLength = 5;
            const valueLength = 5;
            const keyCount = Math.ceil(1500 / (keyLength + valueLength + 2)) + 1;
            {
                for (let i = 0; i < keyCount; ++i) {
                    const res = uut.set(i.toString().padStart(keyLength, ' '), i.toString().padEnd(valueLength, ' '));
                    chai_1.assert.isTrue(res);
                }
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                }, stats);
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: keyCount * (keyLength + valueLength + 2) - 2,
                    segments: 2,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                for (let i = 0; i < keyCount; ++i) {
                    const res = uut.tryGet(i.toString().padStart(keyLength, ' '));
                    chai_1.assert.strictEqual(res, i.toString().padEnd(valueLength, ' '));
                }
                const listResult = [];
                let listDone = false;
                uut.list('', (key, value) => {
                    if (!key || !value) {
                        listDone = true;
                        return segdb_1.SegDBListControl.Stop;
                    }
                    listResult.push([key, value]);
                    return segdb_1.SegDBListControl.Continue;
                });
                chai_1.assert.isTrue(listDone);
                chai_1.assert.equal(listResult.length, keyCount);
                for (let i = 0; i < keyCount; ++i) {
                    chai_1.assert.strictEqual(listResult[i][0], i.toString().padStart(keyLength, ' '));
                    chai_1.assert.strictEqual(listResult[i][1], i.toString().padEnd(valueLength, ' '));
                }
            }
        });
        it('should merge', function () {
            const uut = new segdb_1.SegDB({
                segmentMergeThreshold: 1000,
                writingThresholdToCheckPoint: 1000,
                splitThreshold: 1000,
                mergeThreshold: 1000,
            });
            uut.resetOnRespawn(0, 10);
            const keyLength = 5;
            const valueLength = 5;
            const keyCount = Math.ceil(1500 / (keyLength + valueLength + 2)) + 1;
            const deleteCount = Math.floor(keyCount / 3);
            {
                for (let i = 0; i < keyCount; ++i) {
                    const res = uut.set(i.toString().padStart(keyLength, ' '), i.toString().padEnd(valueLength, ' '));
                    chai_1.assert.isTrue(res);
                }
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                }, stats);
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: keyCount * (keyLength + valueLength + 2) - 2,
                    segments: 2,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                for (let i = 0; i < deleteCount; ++i) {
                    const res = uut.delete(i.toString().padStart(keyLength, ' '));
                    chai_1.assert.isTrue(res);
                }
                for (let i = keyCount - deleteCount; i < keyCount; ++i) {
                    const res = uut.delete(i.toString().padStart(keyLength, ' '));
                    chai_1.assert.isTrue(res);
                }
                uut.requestCheckpoint();
                uut.requestMerge();
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: (keyCount - 2 * deleteCount) * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                for (let i = deleteCount; i < keyCount - deleteCount; ++i) {
                    const res = uut.tryGet(i.toString().padStart(keyLength, ' '));
                    chai_1.assert.strictEqual(res, i.toString().padEnd(valueLength, ' '));
                }
            }
        });
        it('should compact', function () {
            const uut = new segdb_1.SegDB({
                segmentMergeThreshold: 1000,
                writingThresholdToCheckPoint: 1000,
                splitThreshold: 1000,
                mergeThreshold: 1000,
                compactTarget: 1000,
            });
            uut.resetOnRespawn(0, 10);
            const keyLength = 5;
            const valueLength = 5;
            const keyCount = Math.ceil(600 / (keyLength + valueLength + 2)) + 1;
            {
                for (let i = 0; i < 2 * keyCount; ++i) {
                    const res = uut.set(i.toString().padStart(keyLength, ' '), i.toString().padEnd(valueLength, ' '));
                    chai_1.assert.isTrue(res);
                }
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 2 * keyCount * (keyLength + valueLength + 2) - 2,
                    segments: 2,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                for (let i = 2 * keyCount; i < 3 * keyCount; ++i) {
                    const res = uut.set(i.toString().padStart(keyLength, ' '), i.toString().padEnd(valueLength, ' '));
                    chai_1.assert.isTrue(res);
                }
                uut.requestCheckpoint();
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 3 * keyCount * (keyLength + valueLength + 2) - 3,
                    segments: 3,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                for (let i = 3 * keyCount; i < 4 * keyCount; ++i) {
                    const res = uut.set(i.toString().padStart(keyLength, ' '), i.toString().padEnd(valueLength, ' '));
                    chai_1.assert.isTrue(res);
                }
                uut.requestCheckpoint();
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 4 * keyCount * (keyLength + valueLength + 2) - 4,
                    segments: 4,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
                uut.requestCompact();
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                for (let i = 0; i < 4 * keyCount; ++i) {
                    const res = uut.tryGet(i.toString().padStart(keyLength, ' '));
                    chai_1.assert.strictEqual(res, i.toString().padEnd(valueLength, ' '));
                }
                const stats = uut.getStats();
                chai_1.assert.deepEqual({
                    totalLength: 4 * keyCount * (keyLength + valueLength + 2) - 3,
                    segments: 3,
                    writingLength: 0,
                    spaceLimit: 900000,
                }, stats);
            }
        });
        it('should handle delete mark and escaped delete mark', function () {
            const uut = new segdb_1.SegDB();
            {
                uut.resetOnRespawn(0, 10);
                chai_1.assert.isTrue(uut.set('a', '$'));
                chai_1.assert.isTrue(uut.set('b', '\\$'));
                chai_1.assert.isTrue(uut.set('c', '\\'));
                chai_1.assert.isTrue(uut.set('d', '\\\\$'));
                chai_1.assert.isTrue(uut.set('e', 'e'));
                chai_1.assert.isTrue(uut.delete('e'));
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                chai_1.assert.strictEqual('$', uut.tryGet('a'));
                chai_1.assert.strictEqual('\\$', uut.tryGet('b'));
                chai_1.assert.strictEqual('\\', uut.tryGet('c'));
                chai_1.assert.strictEqual('\\\\$', uut.tryGet('d'));
                chai_1.assert.strictEqual(undefined, uut.tryGet('e'));
                uut.requestCheckpoint();
                uut.tick([], 10, 10);
                MockedWorld.tick();
            }
            {
                chai_1.assert.strictEqual('$', uut.tryGet('a'));
                chai_1.assert.strictEqual('\\$', uut.tryGet('b'));
                chai_1.assert.strictEqual('\\', uut.tryGet('c'));
                chai_1.assert.strictEqual('\\\\$', uut.tryGet('d'));
                chai_1.assert.strictEqual(undefined, uut.tryGet('e'));
            }
        });
    });
});
