const jschardet = require('../src')
const utils = require('./utils')

test('detectEncodings shouldn\'t accept unknown encodings', async () => {
    const fixturePath = `${__dirname}/fixtures/windows-1252-de_DE.txt`;
    fileContents = await utils.readFileAsBuffer(fixturePath)
    expect(function() {
        jschardet.detect(fileContents, {
            detectEncodings: ["UTF-14"]
        });
    }).toThrowError("Encoding UTF-14 is not supported")
})

test('detectEncodings locks down which encodings to detect', async () => {
    const fixturePath = `${__dirname}/fixtures/windows-1252-de_DE.txt`;
    fileContents = await utils.readFileAsBuffer(fixturePath)

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

test('detectEncodings locks down which encodings to detect (SHIFT_JIS)', async () => {
    const fixturePath = `${__dirname}/fixtures/Shift_JIS-ja_JP.txt`;
    fileContents = await utils.readFileAsBuffer(fixturePath)

    const possibleEncodings = jschardet.detectAll(fileContents, {
        detectEncodings: ["UTF-8", "SHIFT_JIS", "EUC-JP"],
    });
    const singleEncoding = jschardet.detect(fileContents, {
        detectEncodings: ["UTF-8", "SHIFT_JIS", "EUC-JP"],
    });
    expect(possibleEncodings.length).toBe(1)
    expect(possibleEncodings[0].encoding).toBe("SHIFT_JIS")
    expect(singleEncoding.encoding).toBe("SHIFT_JIS")

    // Now we test that the minimumThreshold is working
    const shortFixturePath = `${__dirname}/fixtures/Shift_JIS-ja_JP-short.txt`;
    fileContents = await utils.readFileAsBuffer(shortFixturePath)

    const shortSingleEncoding = jschardet.detect(fileContents, {
        minimumThreshold: 0,
        detectEncodings: ["UTF-8", "SHIFT_JIS", "EUC-JP"]
    });
    expect(shortSingleEncoding.encoding).toBe("SHIFT_JIS")
});
