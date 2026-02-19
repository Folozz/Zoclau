/**
 * Environment variable parsing and model helpers.
 * Adapted from Claudian for consistency.
 */

export interface EnvModelOption {
    value: string;
    label: string;
    description: string;
}

const CUSTOM_MODEL_ENV_KEYS = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

function getModelTypeFromEnvKey(envKey: string): string {
    if (envKey === 'ANTHROPIC_MODEL') return 'model';
    const match = envKey.match(/ANTHROPIC_DEFAULT_(\w+)_MODEL/);
    return match ? match[1].toLowerCase() : envKey;
}

/**
 * Parse environment variables from a multi-line string.
 * Supports KEY=VALUE format, optional 'export' prefix,
 * comments (#), and quoted values.
 */
export function parseEnvironmentVariables(text: string): Record<string, string> {
    const vars: Record<string, string> = {};
    if (!text) return vars;

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Remove optional 'export ' prefix
        const clean = trimmed.replace(/^export\s+/, '');
        const eqIdx = clean.indexOf('=');
        if (eqIdx <= 0) continue;

        const key = clean.substring(0, eqIdx).trim();
        let value = clean.substring(eqIdx + 1).trim();

        // Remove surrounding quotes
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key) {
            vars[key] = value;
        }
    }

    return vars;
}

/**
 * Build model options from environment variables, same behavior as Claudian.
 */
export function getModelsFromEnvironment(envVars: Record<string, string>): EnvModelOption[] {
    const modelMap = new Map<string, { types: string[]; label: string }>();

    for (const envKey of CUSTOM_MODEL_ENV_KEYS) {
        const type = getModelTypeFromEnvKey(envKey);
        const modelValue = envVars[envKey];
        if (!modelValue) continue;

        const label = modelValue.includes('/')
            ? modelValue.split('/').pop() || modelValue
            : modelValue.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

        if (!modelMap.has(modelValue)) {
            modelMap.set(modelValue, { types: [type], label });
        } else {
            modelMap.get(modelValue)!.types.push(type);
        }
    }

    const typePriority: Record<string, number> = {
        model: 4,
        haiku: 3,
        sonnet: 2,
        opus: 1,
    };

    const sortedEntries = Array.from(modelMap.entries()).sort(([, aInfo], [, bInfo]) => {
        const aPriority = Math.max(...aInfo.types.map((t) => typePriority[t] || 0));
        const bPriority = Math.max(...bInfo.types.map((t) => typePriority[t] || 0));
        return bPriority - aPriority;
    });

    return sortedEntries.map(([value, info]) => {
        const sortedTypes = [...info.types].sort((a, b) => (typePriority[b] || 0) - (typePriority[a] || 0));
        return {
            value,
            label: info.label,
            description: `Custom model (${sortedTypes.join(', ')})`,
        };
    });
}

/**
 * Return the preferred model from environment variables, if present.
 */
export function getCurrentModelFromEnvironment(envVars: Record<string, string>): string | null {
    if (envVars.ANTHROPIC_MODEL) return envVars.ANTHROPIC_MODEL;
    if (envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL) return envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    if (envVars.ANTHROPIC_DEFAULT_SONNET_MODEL) return envVars.ANTHROPIC_DEFAULT_SONNET_MODEL;
    if (envVars.ANTHROPIC_DEFAULT_OPUS_MODEL) return envVars.ANTHROPIC_DEFAULT_OPUS_MODEL;
    return null;
}
