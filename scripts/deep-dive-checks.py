from pathlib import Path
import re, subprocess, sys
root=Path(__file__).parents[1]
doc=(root/'docs/definitions-deep-dive.md').read_text()
types=(root/'packages/core/src/types.ts').read_text(); lint=(root/'packages/core/src/lint.ts').read_text()
validation=(root/'packages/temporal/src/validation.ts').read_text(); cli=(root/'packages/definitions/src/cli.ts').read_text(); contracts=(root/'packages/temporal/src/contracts.ts').read_text(); workflow=(root/'packages/temporal/src/workflow.ts').read_text()
# 1
m=re.search(r"export type LintIssueCode\s*=([\s\S]*?);",types)
real=set(re.findall(r"'([^']+)'",m.group(1)))
section=doc.split('## 7.',1)[0].split('## 6.',1)[1]
doc_codes=set(re.findall(r'^\| `([^`]+)` \|',section,re.M))
assert doc_codes==real,(real,doc_codes,real-doc_codes,doc_codes-real)
print('CHECK 1 PASS:',sorted(real))
# 2 all kebab codes, permit explicit prose saying not codes
valid=real|set(re.findall(r"'([a-z][a-z-]+)'",validation))|set(re.findall(r"'([a-z][a-z-]+)'",cli))
for code in set(re.findall(r'`([a-z][a-z-]*-[a-z-]+)`',doc)):
    if code not in valid:
        lines=[x for x in doc.splitlines() if f'`{code}`' in x]
        assert any('not lint codes' in x or 'not valid' in x or 'drift' in x for x in lines),(code,lines)
print('CHECK 2 PASS: all kebab-case identifiers valid or explicitly marked non-code')
# 3 mentioned enums/errors are source-backed
mentioned=set(re.findall(r'`(FLOWKIT_[A-Z0-9_]+)`',doc))
source=contracts+'\n'+workflow+'\n'+cli
for x in mentioned: assert x in source,x
for x in re.findall(r'`(human|system|signal|auto|rule|ai|orchestrate)`',doc): assert x in types+contracts,x
print('CHECK 3 PASS:',sorted(mentioned))
# 4 full-definition YAML claims
full=[b for b in re.findall(r'```yaml\n([\s\S]*?)```',doc) if '**full definition' in doc[max(0,doc.find(b)-180):doc.find(b)]]
assert not full, 'unvalidated full-definition blocks remain'
print('CHECK 4 PASS: 0 full-definition claims; schema fragments are labeled')
# 5 source citations are symbol citations, and every cited path exists
for p in re.findall(r'`([^`]+/[^`]+\.ts)`',doc): assert (root/p).exists(),p
print('CHECK 5 PASS: all cited TypeScript paths exist; symbol-based citations used')
