const jschardet = require('../src')
const fs = require('fs/promises');

// TODO: move this to some test utils function
async function readFileAsBuffer(path) {
    const fileHandler = await fs.open(path, 'r');
    const fileStats = await fs.stat(path);
    var fileContents = Buffer.alloc(fileStats.size);
    await fileHandler.read(fileContents, 0, fileContents.length);
    fileHandler.close();
    return fileContents;
}

test('detectEncodings shouldn\'t accept unknown encodings', async () => {
    const fixturePath = `${__dirname}/fixtures/windows-1252-de_DE.txt`;
    fileContents = await readFileAsBuffer(fixturePath)
    expect(function() {
        jschardet.detect(fileContents, {
            detectEncodings: ["UTF-14"]
        });
    }).toThrowError("Encoding UTF-14 is not supported")
})

test('detectEncodings locks down which encodings to detect', async () => {
    const fixturePath = `${__dirname}/fixtures/windows-1252-de_DE.txt`;
    fileContents = await readFileAsBuffer(fixturePath)

    const possibleEncodings = jschardet.detectAll(fileContents, {
        detectEncodings: ["UTF-8", "windows-1252"]
    });
    const singleEncoding = jschardet.detect(fileContents, {
        detectEncodings: ["UTF-8", "windows-1252"]
    });
    expect(possibleEncodings.length).toBe(1)
    expect(possibleEncodings[0].encoding).toBe("windows-1252")
    expect(singleEncoding.encoding).toBe("windows-1252")
});
