require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

// Test the my positions functionality
async function getMyPositions() {
  console.log('📊 Getting your current positions...\n');
  
  const pythonScript = path.join(__dirname, 'check_balance.py');
  const pythonProcess = spawn('python3', [pythonScript]);

  let output = '';
  
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });

  return new Promise((resolve) => {
    pythonProcess.on('close', (code) => {
      console.log(output);
      resolve();
    });
  });
}

// Run it
getMyPositions();