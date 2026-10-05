import * as zlib from 'zlib';

export interface SheetData {
  name: string;
  headers: string[];
  rows: any[][];
}

export class ExportService {
  /**
   * Escapes XML characters for safe inclusion in spreadsheet XML.
   */
  public static escapeXml(str: unknown): string {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Converts 0-based column index to Excel column name (0 -> 'A', 25 -> 'Z', 26 -> 'AA', etc.)
   */
  public static colName(n: number): string {
    let s = '';
    while (n >= 0) {
      s = String.fromCharCode((n % 26) + 65) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  /**
   * Sanitizes a sheet name for Excel compatibility:
   * - Max 31 characters
   * - Cannot contain: \ / ? * [ ] :
   * - Disambiguates duplicate names
   */
  public static sanitizeSheetName(name: string, existingNames: Set<string>): string {
    let cleaned = (name || 'Sheet')
      .replace(/[\\/?*[\]:]/g, '_')
      .trim()
      .substring(0, 28) || 'Sheet';

    let finalName = cleaned;
    let counter = 2;
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = `${cleaned.substring(0, 25)}_${counter}`;
      counter++;
    }
    existingNames.add(finalName.toLowerCase());
    return finalName;
  }

  /**
   * Creates a valid, zero-dependency ZIP archive Buffer from file entries using standard DEFLATE.
   */
  public static createZipArchive(files: Array<{ name: string; data: Buffer | string }>): Buffer {
    const localHeaders: Buffer[] = [];
    const centralHeaders: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
      const nameBuf = Buffer.from(file.name, 'utf8');
      const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
      const uncompressedSize = dataBuf.length;
      const crc = zlib.crc32(dataBuf);
      const compressedData = zlib.deflateRawSync(dataBuf);
      const compressedSize = compressedData.length;

      // Local File Header (30 bytes + filename)
      const lh = Buffer.alloc(30 + nameBuf.length);
      lh.writeUInt32LE(0x04034b50, 0); // signature
      lh.writeUInt16LE(20, 4); // version needed: 2.0
      lh.writeUInt16LE(0, 6); // general purpose flags
      lh.writeUInt16LE(8, 8); // compression: deflate
      lh.writeUInt16LE(0, 10); // file mod time
      lh.writeUInt16LE(0, 12); // file mod date
      lh.writeUInt32LE(crc, 14); // crc-32
      lh.writeUInt32LE(compressedSize, 18); // compressed size
      lh.writeUInt32LE(uncompressedSize, 22); // uncompressed size
      lh.writeUInt16LE(nameBuf.length, 26); // filename length
      lh.writeUInt16LE(0, 28); // extra field length
      nameBuf.copy(lh, 30);

      localHeaders.push(lh, compressedData);

      // Central Directory Header (46 bytes + filename)
      const ch = Buffer.alloc(46 + nameBuf.length);
      ch.writeUInt32LE(0x02014b50, 0); // signature
      ch.writeUInt16LE(20, 4); // version made by
      ch.writeUInt16LE(20, 6); // version needed
      ch.writeUInt16LE(0, 8); // flags
      ch.writeUInt16LE(8, 10); // compression: deflate
      ch.writeUInt16LE(0, 12); // mod time
      ch.writeUInt16LE(0, 14); // mod date
      ch.writeUInt32LE(crc, 16); // crc-32
      ch.writeUInt32LE(compressedSize, 20); // compressed size
      ch.writeUInt32LE(uncompressedSize, 24); // uncompressed size
      ch.writeUInt16LE(nameBuf.length, 28); // filename length
      ch.writeUInt16LE(0, 30); // extra field len
      ch.writeUInt16LE(0, 32); // comment len
      ch.writeUInt16LE(0, 34); // disk number start
      ch.writeUInt16LE(0, 36); // internal file attributes
      ch.writeUInt32LE(0, 38); // external file attributes
      ch.writeUInt32LE(offset, 42); // relative offset of local header
      nameBuf.copy(ch, 46);

      centralHeaders.push(ch);
      offset += lh.length + compressedData.length;
    }

    const centralDirOffset = offset;
    const centralDirSize = centralHeaders.reduce((sum, b) => sum + b.length, 0);

    // End of Central Directory Record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // signature
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk where central dir starts
    eocd.writeUInt16LE(files.length, 8); // number of central directory records on this disk
    eocd.writeUInt16LE(files.length, 10); // total records
    eocd.writeUInt32LE(centralDirSize, 12); // central directory size
    eocd.writeUInt32LE(centralDirOffset, 16); // offset of central directory
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
  }

  /**
   * Generates a complete Excel Workbook (.xlsx) with one or more worksheets.
   */
  public static generateXlsx(sheets: SheetData[]): Buffer {
    if (!sheets || sheets.length === 0) {
      sheets = [{ name: 'Results', headers: ['Value'], rows: [['(Empty)']] }];
    }

    const files: Array<{ name: string; data: string }> = [];

    // 1. [Content_Types].xml
    let contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    contentTypes += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n';
    contentTypes += '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n';
    contentTypes += '  <Default Extension="xml" ContentType="application/xml"/>\n';
    contentTypes += '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n';
    sheets.forEach((_, i) => {
      contentTypes += `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n`;
    });
    contentTypes += '</Types>';
    files.push({ name: '[Content_Types].xml', data: contentTypes });

    // 2. _rels/.rels
    let rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    rootRels += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n';
    rootRels += '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n';
    rootRels += '</Relationships>';
    files.push({ name: '_rels/.rels', data: rootRels });

    // 3. xl/workbook.xml
    let workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    workbookXml += '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n';
    workbookXml += '  <sheets>\n';
    sheets.forEach((s, i) => {
      const sheetId = i + 1;
      workbookXml += `    <sheet name="${this.escapeXml(s.name)}" sheetId="${sheetId}" r:id="rId${sheetId}"/>\n`;
    });
    workbookXml += '  </sheets>\n';
    workbookXml += '</workbook>';
    files.push({ name: 'xl/workbook.xml', data: workbookXml });

    // 4. xl/_rels/workbook.xml.rels
    let wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    wbRels += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n';
    sheets.forEach((_, i) => {
      const sheetId = i + 1;
      wbRels += `  <Relationship Id="rId${sheetId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetId}.xml"/>\n`;
    });
    wbRels += '</Relationships>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: wbRels });

    // 5. Worksheets
    sheets.forEach((sheet, i) => {
      let wsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
      wsXml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n';
      wsXml += '  <sheetData>\n';

      // Header row
      if (sheet.headers && sheet.headers.length > 0) {
        wsXml += '    <row r="1">\n';
        sheet.headers.forEach((h, colIdx) => {
          const ref = this.colName(colIdx) + '1';
          wsXml += `      <c r="${ref}" t="inlineStr"><is><t>${this.escapeXml(h)}</t></is></c>\n`;
        });
        wsXml += '    </row>\n';
      }

      // Data rows
      sheet.rows.forEach((row, rowIdx) => {
        const rNum = rowIdx + 2;
        wsXml += `    <row r="${rNum}">\n`;
        row.forEach((val, colIdx) => {
          const ref = this.colName(colIdx) + rNum;
          if (val === null || val === undefined || val === '') {
            // empty cell
          } else if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
            wsXml += `      <c r="${ref}"><v>${val}</v></c>\n`;
          } else if (typeof val === 'boolean') {
            wsXml += `      <c r="${ref}" t="b"><v>${val ? 1 : 0}</v></c>\n`;
          } else {
            const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
            wsXml += `      <c r="${ref}" t="inlineStr"><is><t>${this.escapeXml(strVal)}</t></is></c>\n`;
          }
        });
        wsXml += '    </row>\n';
      });

      wsXml += '  </sheetData>\n';
      wsXml += '</worksheet>';
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: wsXml });
    });

    return this.createZipArchive(files);
  }

  /**
   * Flattens and discovers all arrays in a JSON payload, generating a primary sheet
   * plus a dedicated sheet / tab for each array discovered.
   */
  public static jsonToWorkbookSheets(json: unknown, rootSheetName = 'Results'): SheetData[] {
    const sheets: SheetData[] = [];
    const existingNames = new Set<string>();

    if (json === null || json === undefined) {
      return [{ name: rootSheetName, headers: ['Value'], rows: [['(Empty)']] }];
    }

    // Discover nested arrays to create separate tabs
    const arraySheetsToBuild: Array<{
      name: string;
      parentLabel?: string;
      items: any[];
    }> = [];

    if (Array.isArray(json)) {
      // Root is an array of items
      const rootHeadersSet = new Set<string>();
      const rootRows: any[][] = [];

      // Discover all keys across all items
      json.forEach((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          Object.keys(item).forEach((k) => rootHeadersSet.add(k));
        }
      });

      const rootHeaders = rootHeadersSet.size > 0 ? Array.from(rootHeadersSet) : ['Value'];

      // Also look for array properties within each item
      const childArrayMap = new Map<string, any[]>();

      json.forEach((item, parentIdx) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const rowVals: any[] = [];
          const parentIdentifier = item.id || item.name || item.key || `#${parentIdx + 1}`;

          rootHeaders.forEach((h) => {
            const val = item[h];
            if (Array.isArray(val)) {
              rowVals.push(`[${val.length} ${val.length === 1 ? 'item' : 'items'}]`);
              if (val.length > 0) {
                if (!childArrayMap.has(h)) {
                  childArrayMap.set(h, []);
                }
                val.forEach((childItem, cIdx) => {
                  childArrayMap.get(h)!.push({
                    _parent_index: parentIdx + 1,
                    _parent_id: parentIdentifier,
                    ...(typeof childItem === 'object' && childItem !== null && !Array.isArray(childItem)
                      ? childItem
                      : { value: childItem }),
                  });
                });
              }
            } else if (val && typeof val === 'object') {
              rowVals.push(JSON.stringify(val));
            } else {
              rowVals.push(val);
            }
          });
          rootRows.push(rowVals);
        } else {
          // Primitive in array
          rootRows.push([item]);
        }
      });

      sheets.push({
        name: this.sanitizeSheetName(rootSheetName, existingNames),
        headers: rootHeaders,
        rows: rootRows,
      });

      // Add discovered child array sheets
      childArrayMap.forEach((childItems, arrayKey) => {
        arraySheetsToBuild.push({
          name: arrayKey,
          items: childItems,
        });
      });
    } else if (typeof json === 'object') {
      // Root is an object
      const obj = json as Record<string, any>;
      const scalarKeys: string[] = [];
      const arrayKeys: string[] = [];

      Object.keys(obj).forEach((k) => {
        if (Array.isArray(obj[k])) {
          arrayKeys.push(k);
        } else {
          scalarKeys.push(k);
        }
      });

      // If there are scalar keys, create a summary root sheet
      if (scalarKeys.length > 0 || arrayKeys.length === 0) {
        const rootHeaders = scalarKeys.length > 0 ? scalarKeys : ['Property', 'Value'];
        const rootRows: any[][] = [];

        if (scalarKeys.length > 0) {
          const rowVals = scalarKeys.map((k) => {
            const v = obj[k];
            return v && typeof v === 'object' ? JSON.stringify(v) : v;
          });
          rootRows.push(rowVals);
        }

        sheets.push({
          name: this.sanitizeSheetName('Overview', existingNames),
          headers: rootHeaders,
          rows: rootRows,
        });
      }

      // Add each top-level array property as a sheet
      arrayKeys.forEach((arrKey) => {
        const arrVal = obj[arrKey] as any[];
        arraySheetsToBuild.push({
          name: arrKey,
          items: arrVal,
        });
      });
    } else {
      // Primitive
      sheets.push({
        name: this.sanitizeSheetName(rootSheetName, existingNames),
        headers: ['Value'],
        rows: [[json]],
      });
    }

    // Process all discovered array sheets (using a queue to extract nested arrays at any depth)
    const queue: Array<{ name: string; items: any[] }> = [...arraySheetsToBuild];
    while (queue.length > 0) {
      const { name, items } = queue.shift()!;
      const sheetName = this.sanitizeSheetName(name, existingNames);
      if (!items || items.length === 0) {
        sheets.push({
          name: sheetName,
          headers: ['Status'],
          rows: [['(Empty Array)']],
        });
        continue;
      }

      const headersSet = new Set<string>();
      items.forEach((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          Object.keys(item).forEach((k) => headersSet.add(k));
        }
      });

      const headers = headersSet.size > 0 ? Array.from(headersSet) : ['Value'];
      const childArrayMap = new Map<string, any[]>();

      const rows = items.map((item, parentIdx) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const parentIdentifier = item.id || item.name || item.key || item._parent_id || `#${parentIdx + 1}`;
          return headers.map((h) => {
            const v = item[h];
            if (Array.isArray(v)) {
              if (v.length > 0) {
                if (!childArrayMap.has(h)) {
                  childArrayMap.set(h, []);
                }
                v.forEach((childItem) => {
                  childArrayMap.get(h)!.push({
                    _parent_index: parentIdx + 1,
                    _parent_id: parentIdentifier,
                    ...(typeof childItem === 'object' && childItem !== null && !Array.isArray(childItem)
                      ? childItem
                      : { value: childItem }),
                  });
                });
              }
              return `[${v.length} ${v.length === 1 ? 'item' : 'items'}]`;
            } else if (v && typeof v === 'object') {
              return JSON.stringify(v);
            }
            return v;
          });
        }
        return [item];
      });

      sheets.push({
        name: sheetName,
        headers,
        rows,
      });

      childArrayMap.forEach((childItems, arrayKey) => {
        queue.push({
          name: `${name}_${arrayKey}`,
          items: childItems,
        });
      });
    }

    return sheets;
  }

  /**
   * Generates standard RFC 4180 CSV string from a tabular dataset.
   */
  public static jsonToCsv(data: unknown): string {
    if (!data) return '';

    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (typeof data === 'object') {
      items = [data];
    } else {
      return String(data);
    }

    if (items.length === 0) return '';

    const headersSet = new Set<string>();
    items.forEach((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        Object.keys(item).forEach((k) => headersSet.add(k));
      }
    });

    const headers = headersSet.size > 0 ? Array.from(headersSet) : ['Value'];

    const escapeCsvField = (field: any): string => {
      if (field === null || field === undefined) return '';
      let str = typeof field === 'object' ? JSON.stringify(field) : String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        str = `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines: string[] = [];
    lines.push(headers.map(escapeCsvField).join(','));

    items.forEach((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const row = headers.map((h) => escapeCsvField(item[h]));
        lines.push(row.join(','));
      } else {
        lines.push(escapeCsvField(item));
      }
    });

    return lines.join('\r\n');
  }
}
