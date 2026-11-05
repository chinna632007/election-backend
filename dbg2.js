const ba = require('./src/modules/randomization/ballot-allocation.js');
const XLSX = require('xlsx');
const wb = XLSX.readFile('/home/arc/Downloads/importsdata/kakinada_polling_stations.xlsx');
const ws = wb.Sheets['Sheet1'];
// replicate readGrid: sheet_to_json with raw:false
const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
console.log('grid[0]:', JSON.stringify(grid[0]));
const { mapHeader } = ba;
const { colMap, headerRow } = mapHeader(grid);
console.log('headerRow', headerRow, 'colMap', JSON.stringify(colMap));
