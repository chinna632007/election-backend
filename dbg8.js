const ba = require('./src/modules/randomization/ballot-allocation.js');
const XLSX = require('xlsx');
const buf = require('fs').readFileSync('/home/arc/Downloads/importsdata/kakinada_polling_stations.xlsx');
console.log('buffer type:', buf instanceof Buffer, 'length:', buf.length);
const grid = ba.readGrid(buf);
console.log('grid length:', grid.length);
console.log('grid[0]:', JSON.stringify(grid[0]));
console.log('grid[1]:', JSON.stringify(grid[1]));
console.log('grid[2]:', JSON.stringify(grid[2]));
