import { assert } from 'chai';
import { SegDB, SegDBListControl } from '../src/segdb';

describe('SegDB', function () {
    beforeEach(function () {
        MockedWorld.reset();
    });

    it('should resetOnRespawn', function () {
        const uut = new SegDB();
        {
            uut.resetOnRespawn(0, 10);
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 0,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            const res = uut.set('a', 'aaa');
            assert.isTrue(res);
            assert.strictEqual('aaa', uut.tryGet('a'));
            uut.tick([], 10, 10);

            MockedWorld.tick();
        }

        {
            assert.strictEqual('aaa', uut.tryGet('a'));
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 5,
                    segments: 1,
                    writingLength: 5,
                    spaceLimit: 900000,
                },
                stats,
            );
        }
    });

    it('should reload after global reset', function () {
        let uut = new SegDB();
        uut.resetOnRespawn(0, 10);

        {
            const res = uut.set('a', 'aaa');
            assert.isTrue(res);
            assert.strictEqual('aaa', uut.tryGet('a'));
            uut.tick([], 10, 10);

            MockedWorld.tick();
        }

        uut = new SegDB();
        {
            let got = false;
            const res = uut.get('a', (v, k) => {
                got = true;
                assert.strictEqual('a', k);
                assert.strictEqual('aaa', v);
            });
            assert.isFalse(res);
            uut.tick([], 10, 10);
            assert.isFalse(got);

            MockedWorld.tick();
            uut.tick([], 10, 10);
            assert.isTrue(got);
        }
    });

    it('should checkpoint', function () {
        const uut = new SegDB({ writingThresholdToCheckPoint: 10000 });
        uut.resetOnRespawn(0, 10);

        const keyLength = 5;
        const valueLength = 5;
        const keyCount = Math.ceil(10000 / (keyLength + valueLength + 2)) + 1;

        {
            for (let i = 0; i < keyCount; ++i) {
                const k = i.toString().padStart(keyLength, ' ');
                const v = i.toString().padStart(valueLength, ' ');
                const res = uut.set(k, v);
                assert.isTrue(res);
            }

            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                },
                stats,
            );

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: keyCount * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );
        }
    });

    it('should list', function () {
        const uut = new SegDB({ writingThresholdToCheckPoint: 10000 });
        uut.resetOnRespawn(0, 10);

        const keyLength = 7;
        const valueLength = 5;
        const keyCount = Math.ceil(10000 / (keyLength + valueLength + 2)) + 1;

        {
            for (let i = 0; i < keyCount; ++i) {
                const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                const v = i.toString().padStart(valueLength, ' ');

                const res = uut.set(k, v);
                assert.isTrue(res);
            }

            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                },
                stats,
            );

            const listA: [string, string][] = [];
            let listAFinished = false;
            const listB: [string, string][] = [];
            let listBFinished = false;
            const listAll: [string, string][] = [];
            let listAllFinished = false;

            uut.list('a.', (key, value) => {
                if (key === null || value === null || !key.startsWith('a.')) {
                    listAFinished = true;
                    return SegDBListControl.Stop;
                }

                listA.push([key, value]);
                return SegDBListControl.Continue;
            });

            uut.list('b.', (key, value) => {
                if (key === null || value === null || !key.startsWith('b.')) {
                    listBFinished = true;
                    return SegDBListControl.Stop;
                }

                listB.push([key, value]);
                return SegDBListControl.Continue;
            });

            uut.list('', (key, value) => {
                if (key === null || value === null) {
                    listAllFinished = true;
                    return SegDBListControl.Stop;
                }

                listAll.push([key, value]);
                return SegDBListControl.Continue;
            });

            assert.isTrue(listAFinished);
            assert.equal(listA.length, keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listA[i][0], k);
                assert.equal(listA[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            assert.isTrue(listBFinished);
            assert.equal(listB.length, 0);

            assert.isTrue(listAllFinished);
            assert.equal(listAll.length, keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listAll[i][0], k);
                assert.equal(listAll[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            for (let i = 0; i < keyCount; ++i) {
                const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                const v = i.toString().padStart(valueLength, ' ');

                const res = uut.set(k, v);
                assert.isTrue(res);
            }

            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 2 * keyCount * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                },
                stats,
            );

            const listA: [string, string][] = [];
            let listAFinished = false;
            const listB: [string, string][] = [];
            let listBFinished = false;
            const listAll: [string, string][] = [];
            let listAllFinished = false;

            uut.list('a.', (key, value) => {
                if (key === null || value === null || !key.startsWith('a.')) {
                    listAFinished = true;
                    return SegDBListControl.Stop;
                }

                listA.push([key, value]);
                return SegDBListControl.Continue;
            });

            uut.list('b.', (key, value) => {
                if (key === null || value === null || !key.startsWith('b.')) {
                    listBFinished = true;
                    return SegDBListControl.Stop;
                }

                listB.push([key, value]);
                return SegDBListControl.Continue;
            });

            uut.list('', (key, value) => {
                if (key === null || value === null) {
                    listAllFinished = true;
                    return SegDBListControl.Stop;
                }

                listAll.push([key, value]);
                return SegDBListControl.Continue;
            });

            assert.isTrue(listAFinished);
            assert.equal(listA.length, keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listA[i][0], k);
                assert.equal(listA[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            assert.isTrue(listBFinished);
            assert.equal(listB.length, keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listB[i][0], k);
                assert.equal(listB[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            assert.isTrue(listAllFinished);
            assert.equal(listAll.length, 2 * keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listAll[i][0], k);
                assert.equal(listAll[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            for (let i = 0; i < keyCount; ++i) {
                const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listAll[i + keyCount][0], k);
                assert.equal(listAll[i + keyCount][1], i.toString().padStart(keyLength - 2, ' '));
            }

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 2 * keyCount * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            const listA: [string, string][] = [];
            let listAFinished = false;
            const listB: [string, string][] = [];
            let listBFinished = false;
            const listAll: [string, string][] = [];
            let listAllFinished = false;

            uut.list('a.', (key, value) => {
                if (key === null || value === null || !key.startsWith('a.')) {
                    listAFinished = true;
                    return SegDBListControl.Stop;
                }

                listA.push([key, value]);
                return SegDBListControl.Continue;
            });

            uut.list('b.', (key, value) => {
                if (key === null || value === null || !key.startsWith('b.')) {
                    listBFinished = true;
                    return SegDBListControl.Stop;
                }

                listB.push([key, value]);
                return SegDBListControl.Continue;
            });

            uut.list('', (key, value) => {
                if (key === null || value === null) {
                    listAllFinished = true;
                    return SegDBListControl.Stop;
                }

                listAll.push([key, value]);
                return SegDBListControl.Continue;
            });

            assert.isTrue(listAFinished);
            assert.equal(listA.length, keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listA[i][0], k);
                assert.equal(listA[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            assert.isTrue(listBFinished);
            assert.equal(listB.length, keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listB[i][0], k);
                assert.equal(listB[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            assert.isTrue(listAllFinished);
            assert.equal(listAll.length, 2 * keyCount);
            for (let i = 0; i < keyCount; ++i) {
                const k = 'a.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listAll[i][0], k);
                assert.equal(listAll[i][1], i.toString().padStart(keyLength - 2, ' '));
            }

            for (let i = 0; i < keyCount; ++i) {
                const k = 'b.' + i.toString().padStart(keyLength - 2, ' ');
                assert.equal(listAll[i + keyCount][0], k);
                assert.equal(listAll[i + keyCount][1], i.toString().padStart(keyLength - 2, ' '));
            }
        }
    });

    it('should list with yield', function () {
        const uut = new SegDB({ writingThresholdToCheckPoint: 10000 });
        uut.resetOnRespawn(0, 10);

        for (let i = 0; i < 100; ++i) {
            uut.set(i.toString().padStart(3, '0'), i.toString());
        }

        let listedCount = 0;
        let listedDone = false;
        uut.list('', (key, value) => {
            if (!key || !value) {
                listedDone = true;
                return SegDBListControl.Stop;
            }

            assert.equal(key, listedCount.toString().padStart(3, '0'));
            assert.equal(value, listedCount.toString());
            ++listedCount;

            return SegDBListControl.Yield;
        });
        assert.equal(listedCount, 1);

        for (let i = 2; i < 100; ++i) {
            uut.tick([], 10, 10);
            MockedWorld.tick();

            assert.equal(listedCount, i);
            assert.isFalse(listedDone);
        }

        uut.tick([], 10, 10);
        MockedWorld.tick();

        assert.equal(listedCount, 100);
        assert.isTrue(listedDone);
    });

    it('should delete', function () {
        const uut = new SegDB();
        uut.resetOnRespawn(0, 10);

        {
            const res = uut.set('a', 'a');
            assert.isTrue(res);

            uut.requestCheckpoint();
            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 3,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );
            assert.strictEqual('a', uut.tryGet('a'));

            uut.delete('a');
            assert.strictEqual(undefined, uut.tryGet('a'));

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 6,
                    segments: 1,
                    writingLength: 3,
                    spaceLimit: 900000,
                },
                stats,
            );
            assert.strictEqual(undefined, uut.tryGet('a'));

            uut.requestCheckpoint();

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 0,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );
            assert.strictEqual(undefined, uut.tryGet('a'));
        }
    });

    it('should split', function () {
        const uut = new SegDB({
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
                assert.isTrue(res);
            }

            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                },
                stats,
            );

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: keyCount * (keyLength + valueLength + 2) - 2,
                    segments: 2,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            for (let i = 0; i < keyCount; ++i) {
                const res = uut.tryGet(i.toString().padStart(keyLength, ' '));
                assert.strictEqual(res, i.toString().padEnd(valueLength, ' '));
            }

            const listResult: [string, string][] = [];
            let listDone = false;
            uut.list('', (key, value) => {
                if (!key || !value) {
                    listDone = true;
                    return SegDBListControl.Stop;
                }

                listResult.push([key, value]);
                return SegDBListControl.Continue;
            });
            assert.isTrue(listDone);
            assert.equal(listResult.length, keyCount);
            for (let i = 0; i < keyCount; ++i) {
                assert.strictEqual(listResult[i][0], i.toString().padStart(keyLength, ' '));
                assert.strictEqual(listResult[i][1], i.toString().padEnd(valueLength, ' '));
            }
        }
    });

    it('should merge', function () {
        const uut = new SegDB({
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
                assert.isTrue(res);
            }

            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: keyCount * (keyLength + valueLength + 2),
                    segments: 1,
                    writingLength: keyCount * (keyLength + valueLength + 2),
                    spaceLimit: 900000,
                },
                stats,
            );

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: keyCount * (keyLength + valueLength + 2) - 2,
                    segments: 2,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            for (let i = 0; i < deleteCount; ++i) {
                const res = uut.delete(i.toString().padStart(keyLength, ' '));
                assert.isTrue(res);
            }

            for (let i = keyCount - deleteCount; i < keyCount; ++i) {
                const res = uut.delete(i.toString().padStart(keyLength, ' '));
                assert.isTrue(res);
            }

            uut.requestCheckpoint();
            uut.requestMerge();
            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: (keyCount - 2 * deleteCount) * (keyLength + valueLength + 2) - 1,
                    segments: 1,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            for (let i = deleteCount; i < keyCount - deleteCount; ++i) {
                const res = uut.tryGet(i.toString().padStart(keyLength, ' '));
                assert.strictEqual(res, i.toString().padEnd(valueLength, ' '));
            }
        }
    });

    it('should compact', function () {
        const uut = new SegDB({
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
                assert.isTrue(res);
            }

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 2 * keyCount * (keyLength + valueLength + 2) - 2,
                    segments: 2,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            for (let i = 2 * keyCount; i < 3 * keyCount; ++i) {
                const res = uut.set(i.toString().padStart(keyLength, ' '), i.toString().padEnd(valueLength, ' '));
                assert.isTrue(res);
            }

            uut.requestCheckpoint();
            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 3 * keyCount * (keyLength + valueLength + 2) - 3,
                    segments: 3,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            for (let i = 3 * keyCount; i < 4 * keyCount; ++i) {
                const res = uut.set(i.toString().padStart(keyLength, ' '), i.toString().padEnd(valueLength, ' '));
                assert.isTrue(res);
            }

            uut.requestCheckpoint();
            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 4 * keyCount * (keyLength + valueLength + 2) - 4,
                    segments: 4,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );

            uut.requestCompact();
            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            for (let i = 0; i < 4 * keyCount; ++i) {
                const res = uut.tryGet(i.toString().padStart(keyLength, ' '));
                assert.strictEqual(res, i.toString().padEnd(valueLength, ' '));
            }

            const stats = uut.getStats();
            assert.deepEqual(
                {
                    totalLength: 4 * keyCount * (keyLength + valueLength + 2) - 3,
                    segments: 3,
                    writingLength: 0,
                    spaceLimit: 900000,
                },
                stats,
            );
        }
    });

    it('should handle delete mark and escaped delete mark', function () {
        const uut = new SegDB();

        {
            uut.resetOnRespawn(0, 10);
            assert.isTrue(uut.set('a', '$'));
            assert.isTrue(uut.set('b', '\\$'));
            assert.isTrue(uut.set('c', '\\'));
            assert.isTrue(uut.set('d', '\\\\$'));
            assert.isTrue(uut.set('e', 'e'));
            assert.isTrue(uut.delete('e'));

            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            assert.strictEqual('$', uut.tryGet('a'));
            assert.strictEqual('\\$', uut.tryGet('b'));
            assert.strictEqual('\\', uut.tryGet('c'));
            assert.strictEqual('\\\\$', uut.tryGet('d'));
            assert.strictEqual(undefined, uut.tryGet('e'));

            uut.requestCheckpoint();
            uut.tick([], 10, 10);
            MockedWorld.tick();
        }

        {
            assert.strictEqual('$', uut.tryGet('a'));
            assert.strictEqual('\\$', uut.tryGet('b'));
            assert.strictEqual('\\', uut.tryGet('c'));
            assert.strictEqual('\\\\$', uut.tryGet('d'));
            assert.strictEqual(undefined, uut.tryGet('e'));
        }
    });
});
