const fs = require('fs');

function extractQuestions(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const startMarker = 'const QUESTIONS = [';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) throw new Error('QUESTIONS array not found');
  const arrStart = startIdx + startMarker.length - 1; // include '['
  // find matching closing bracket
  let depth = 0, i = arrStart, inStr = false, strChar = '', escape = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (escape) { escape = false; }
      else if (c === '\\') { escape = true; }
      else if (c === strChar) { inStr = false; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  const arrText = html.slice(arrStart, i);
  // eslint-disable-next-line no-eval
  const QUESTIONS = eval(arrText);
  return QUESTIONS;
}

const path = process.argv[2];
const out = process.argv[3] || 'data/questions.json';
const qs = extractQuestions(path);
fs.writeFileSync(out, JSON.stringify(qs, null, 2), 'utf8');
console.log(`Extracted ${qs.length} questions -> ${out}`);
