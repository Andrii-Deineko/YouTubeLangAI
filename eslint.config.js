import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'src/**',
      'scripts/**',
      '*.config.js',
      'postcss.config.js',
      'tailwind.config.js'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  // Architectural boundary: @langai/contracts imports nothing from @langai/*
  {
    files: ['packages/contracts/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@langai/*'],
              message: '@langai/contracts must have zero internal workspace dependencies.'
            }
          ]
        }
      ]
    }
  },
  // Architectural boundary: @langai/subtitle-kit imports ONLY @langai/contracts
  {
    files: ['packages/subtitle-kit/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@langai/players',
                '@langai/players/*',
                '@langai/translators',
                '@langai/translators/*',
                '@langai/storage',
                '@langai/storage/*',
                '@langai/ui',
                '@langai/ui/*',
                '@langai/core',
                '@langai/core/*',
                '@langai/service-*',
                '@langai/extension'
              ],
              message: '@langai/subtitle-kit may only import @langai/contracts.'
            }
          ]
        }
      ]
    }
  },
  // Architectural boundary: @langai/players imports ONLY @langai/contracts and @langai/subtitle-kit
  {
    files: ['packages/players/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@langai/translators',
                '@langai/translators/*',
                '@langai/storage',
                '@langai/storage/*',
                '@langai/ui',
                '@langai/ui/*',
                '@langai/core',
                '@langai/core/*',
                '@langai/service-*',
                '@langai/extension'
              ],
              message: '@langai/players may only import @langai/contracts and @langai/subtitle-kit.'
            }
          ]
        }
      ]
    }
  },
  // Architectural boundary: core, ui, storage, translators NEVER import @langai/players or @langai/service-*
  {
    files: [
      'packages/core/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
      'packages/storage/src/**/*.{ts,tsx}',
      'packages/translators/src/**/*.{ts,tsx}'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@langai/players',
                '@langai/players/*',
                '@langai/service-*',
                '@langai/extension'
              ],
              message:
                'Core, UI, Storage, and Translators must never import player or service plugins.'
            }
          ]
        }
      ]
    }
  },
  // Architectural boundary: services only import contracts, subtitle-kit, players
  {
    files: ['packages/services/*/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@langai/core',
                '@langai/core/*',
                '@langai/ui',
                '@langai/ui/*',
                '@langai/storage',
                '@langai/storage/*',
                '@langai/translators',
                '@langai/translators/*',
                '@langai/extension'
              ],
              message: 'Service plugins may only import @langai/contracts, @langai/subtitle-kit, and @langai/players.'
            }
          ]
        }
      ]
    }
  }
);
