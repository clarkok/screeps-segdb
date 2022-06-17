export {};

declare global {
    interface MockWorld {
        tick(): void;
        reset(): void;
    }

    const MockedWorld: MockWorld;
}
