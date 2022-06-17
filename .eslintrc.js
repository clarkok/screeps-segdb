module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/no-namespace': 'off'
    },
    overrides: [
        {
            'files': ['./test/integration/helper.ts'],
            'rules': {
                '@typescript-eslint/no-explicit-any': 'off',
            }
        },
        {
            'files': ['./third_party/screeps-profiler/index.d.ts'],
            'rules': {
                '@typescript-eslint/no-explicit-any': 'off',
                '@typescript-eslint/ban-types': 'off',
                'no-var': 'off',
            }
        },
        {
            'files': ['./tools/room-selector.ts', './tools/room-terrain.ts'],
            'rules': {
                '@typescript-eslint/no-explicit-any': 'off',
            }
        }
    ],
    plugins: [
        '@typescript-eslint',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
};
