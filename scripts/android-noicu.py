"""Repeat the shipped v13.15 no-ICU adaptations after a fresh server bundle."""
from pathlib import Path
import re,sys
root=Path(sys.argv[1])
letters=r'A-Za-z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF'
emoji=r'^[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2194-\u21FF\u2300-\u23FF\u2460-\u24FF\u2500-\u27BF\u2B00-\u2BFF\u3000-\u303F\uFE0F\u{1F000}-\u{1FAFF}]+$'
for p in root.glob('*.js'):
 s=p.read_text()
 # Regex literals: retain the existing shipped ranges for Cyrillic/Latin/CJK.
 s=s.replace(r'\p{L}\p{Nl}',letters).replace(r'\p{L}\p{N}',letters+'0-9')
 s=s.replace(r'\p{Cc}\p{Cf}',r'\x00-\x1F\x7F-\x9F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF')
 # String constructors have double-escaped property names.
 s=s.replace(r'^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$',emoji.replace('\\','\\\\'))
 s=s.replace(r'\p{Script=Latin}',r'\u0000-\u024F')
 # Direct named os imports snapshot native paths before the bootstrap monkey patch.
 s=re.sub(r'import \{ tmpdir \} from "node:os";', 'const tmpdir = () => process.env.TMPDIR || "/tmp";',s)
 s=re.sub(r'import \{ homedir \} from "node:os";', 'const homedir = () => process.env.HOME || "/";',s)
 p.write_text(s)
print('Applied v13.15-compatible no-ICU and path adaptations')
