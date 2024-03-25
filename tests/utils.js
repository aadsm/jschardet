const fs = require('fs/promises');

async function readFileAsBuffer(path) {
    const fileHandler = await fs.open(path, 'r');
    const fileStats = await fs.stat(path);
    var fileContents = Buffer.alloc(fileStats.size);
    await fileHandler.read(fileContents, 0, fileContents.length);
    fileHandler.close();
    return fileContents;
}

exports.readFileAsBuffer = readFileAsBuffer;
