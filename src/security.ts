import { countTokens as count } from 'gpt-tokenizer/encoding/o200k_base';
import { lintSource } from '@secretlint/core';
import { creator } from '@secretlint/secretlint-rule-preset-recommend';
import type { Scanner } from './types.js';

export const versions = { contextpack: '1.0.0', tokenizer: 'gpt-tokenizer@4.1.0', scanner: '@secretlint/core@13.1.0', rules: '@secretlint/secretlint-rule-preset-recommend@13.1.0', ignore: '7.0.14', picomatch: '4.0.7' };
export const encoding = 'o200k_base';
export function countTokens(text: string): number {
  const result = count(text, { disallowedSpecial: new Set() });
  if (!Number.isSafeInteger(result) || result < 0 || (text.length > 0 && result === 0)) throw new Error('Token counting failed');
  return result;
}
export const scan: Scanner = async text => {
  try {
    const result = await lintSource({
      source: { filePath: 'captured-text.txt', content: text, ext: 'txt', contentType: 'text' },
      options: { noPhysicFilePath: true, maskSecrets: true, config: {
        rules: creator.rules.filter(rule => !rule.meta.id.includes('filter-comments')).map(rule => ({
          id: rule.meta.id, rule,
          options: rule.meta.id.endsWith('rule-aws') ? { enableIDScanRule: true } : {},
        })),
      } },
    });
    return result.messages.length === 0;
  } catch { throw new Error('Secret scanner failed; export blocked'); }
};
export async function checkedScan(text: string, scanner: Scanner): Promise<boolean> {
  try {
    const result = await scanner(text);
    if (typeof result !== 'boolean') throw new Error();
    return result;
  } catch { throw new Error('Secret scanner failed; export blocked'); }
}
