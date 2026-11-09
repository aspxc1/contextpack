# Compatibility spike

Inspected installed Repomix 1.19.0 (Node >=22) public exports and implementation before selecting the adapter. Its public TokenCounter requires init(), but countTokens() catches encoding errors, logs and returns zero. Its runSecurityCheck() uses workers and logs thrown error objects. These behaviors conflict with exact fail-closed counting and non-sensitive diagnostics. Its high-level CLI also loads config and processors.

Use the same lower-level components directly: gpt-tokenizer 4.1.0 o200k_base and Secretlint core/recommended rules 13.1.0. Repomix itself is not a production dependency. The direct adapter throws on counting failure, catches scanner exceptions without their messages, masks findings and returns only a boolean. No CLI/config loader, worker, target plugin, external processor, or remote helper is imported. AWS ID scanning is explicitly enabled; the comment-filter rule is excluded so repository comments cannot disable scanning. Real scanner/tokenizer contract tests guard this boundary.

Maintained ignore 7.0.14 and picomatch 4.0.7 implement their respective syntaxes. Git discovery uses structured arguments, NUL-delimited inventory/check-ignore, --no-index to enforce ignores even for tracked files, and disables fsmonitor on status.

References: https://repomix.com/guide/development/using-repomix-as-a-library and https://repomix.com/guide/security . Installed code, rather than documentation snippets, determined the decision.
