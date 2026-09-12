// Test RFC 4180 parser and Brazilian sanitization

function stripBom(str) {
  if (str.charCodeAt(0) === 0xfeff) {
    return str.slice(1);
  }
  return str;
}

function detectDelimiter(text) {
  // Analyze the first few lines outside quotes
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ',';

  const candidates = [';', ',', '\t', '|'];
  const scores = {};

  for (const delim of candidates) {
    scores[delim] = 0;
    const counts = [];
    for (const line of lines) {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
          inQuotes = !inQuotes;
        } else if (line[i] === delim && !inQuotes) {
          count++;
        }
      }
      counts.push(count);
    }
    // Check if consistent and > 0
    if (counts.length > 0 && counts[0] > 0) {
      const allEqual = counts.every(c => c === counts[0]);
      if (allEqual) {
        scores[delim] = counts[0] * 10;
      } else {
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        scores[delim] = avg;
      }
    }
  }

  let bestDelim = ';'; // default in Brazil
  let maxScore = -1;
  for (const [delim, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestDelim = delim;
    }
  }
  return maxScore > 0 ? bestDelim : (text.includes(';') ? ';' : ',');
}

function parseCsv(text, delimiter) {
  text = stripBom(text);
  if (!delimiter) {
    delimiter = detectDelimiter(text);
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        row.push(field.trim());
        field = '';
        i++;
      } else if (char === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        row.push(field.trim());
        if (row.some(f => f.length > 0)) {
          rows.push(row);
        }
        row = [];
        field = '';
        i++;
      } else if (char === '\n') {
        row.push(field.trim());
        if (row.some(f => f.length > 0)) {
          rows.push(row);
        }
        row = [];
        field = '';
        i++;
      } else {
        field += char;
        i++;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some(f => f.length > 0)) {
      rows.push(row);
    }
  }

  return { rows, delimiter };
}

// Test case 1: Semicolon separated, BOM, Brazilian format
const csv1 = '\uFEFFPedido;Cliente;Endereço;Cidade;UF;Cubagem m3;Peso kg;Volumes\r\nPED-101;\"Mercado Sol, Nascente\";\"Av. Brasil, 1500\";Campinas;SP;2,50;320,0;15\r\nPED-102;Farmácia Central;\"Rua Barão de Jaguara\n820\";Campinas;SP;0,80;65,0;4';

const result1 = parseCsv(csv1);
console.log('Delim detected:', result1.delimiter);
console.log('Rows parsed:', result1.rows.length);
console.log('Header:', result1.rows[0]);
console.log('Row 1:', result1.rows[1]);
console.log('Row 2 with newline in address:', result1.rows[2]);
