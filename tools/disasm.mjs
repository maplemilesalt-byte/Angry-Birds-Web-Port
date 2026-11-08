import fs from 'fs'; import path from 'path';
import { undump, disassemble } from '../src/lua/undump.js';
const [,, inDir, outDir] = process.argv;
for (const f of fs.readdirSync(inDir).filter(f=>f.endsWith('.lua'))) {
  const p = undump(fs.readFileSync(path.join(inDir,f)), f);
  fs.writeFileSync(path.join(outDir, f + '.txt'), disassemble(p).join('\n'));
}
