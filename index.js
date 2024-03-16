#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
const Table = require('cli-table3');
const textract = require('textract');
const util = require('util');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
// import ora from 'ora';
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

dayjs.extend(duration);

const SUPPORTED_FORMATS = ['.pdf', '.txt', '.md',  '.docx', '.rtf', '.epub', '.html' ];

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('wpm', {
    describe: 'Words per minute reading speed',
    type: 'number',
    default: 200
  })
  .option('timesort', {
    describe: 'Sort by reading time in descending order',
    type: 'boolean',
    default: false
  })
  .help()
  .argv;

// Validate wpm
if (isNaN(argv.wpm) || argv.wpm <= 0) {
  console.error('Error: wpm must be a positive number');
  process.exit(1);
}

const WORDS_PER_MINUTE = argv.wpm;

async function getWordCount(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  let pageCount = 0;

  try {
    switch (ext) {
      case '.pdf':
        const dataBuffer = await fs.readFile(filePath);
        const pdfData = await pdf(dataBuffer);
        text = pdfData.text;
        pageCount = pdfData.numpages;
        break;
      case '.docx':
        const result = await mammoth.extractRawText({path: filePath});
        text = result.value;
        pageCount = Math.ceil(text.length / 1781); // Rough estimate
        break;
      default:
        text = await util.promisify(textract.fromFileWithPath)(filePath);
        pageCount = Math.ceil(text.length / 1781);
    }
  } catch (error) {
    // console.error(`Error processing ${filePath}: ${error.message}`);
    return { wordCount: 0, pageCount: 0 };
  }


  const words = text.trim().split(/\s+/);
  return { wordCount: words.length, pageCount };
}

async function getFileStats(filePath) {
  const { wordCount, pageCount } = await getWordCount(filePath);
  const readingTimeMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);
  const readingTime = dayjs.duration(readingTimeMinutes, 'minutes').format('HH:mm:ss');

  return {
    file: path.basename(filePath),
    format: path.extname(filePath).slice(1).toUpperCase(),
    wordCount,
    pageCount,
    readingTime,
    readingTimeMinutes
  };
}

async function processFiles(input) {
  // const spinner = ora('Processing files...').start();

  try {
    const stats = await fs.stat(input);
    let files;

    if (stats.isDirectory()) {
      const allFiles = await fs.readdir(input);
      files = allFiles.filter(file => SUPPORTED_FORMATS.includes(path.extname(file).toLowerCase()))
                      .map(file => path.join(input, file));
    } else if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(input).toLowerCase())) {
      files = [input];
    } else {
      throw new Error('Invalid input. Please provide a supported file or directory.');
    }

    if (files.length === 0) {
      // spinner.fail('No readable documents found');
      return;
    }

    const results = await Promise.all(files.map(getFileStats));

    if (argv.timesort && results.length > 1) {
      results.sort((a, b) => b.readingTimeMinutes - a.readingTimeMinutes);
    }

    const table = new Table({
      head: ['#', 'File', 'Format', 'Word Count', 'Pages', 'Reading Time'],
      style: {
        head: ['cyan'],
        border: ['gray']
      }
    });

    let totalWordCount = 0;
    let totalPageCount = 0;
    let totalReadingTimeMinutes = 0;

    results.forEach((result, index) => {
      table.push([
        index + 1,
        result.file,
        result.format,
        result.wordCount.toLocaleString(),
        result.pageCount.toLocaleString(),
        result.readingTime
      ]);
      totalWordCount += result.wordCount;
      totalPageCount += result.pageCount;
      totalReadingTimeMinutes += result.readingTimeMinutes;
    });

    // spinner.succeed('Processing complete');
    console.log(table.toString());

    if (results.length > 1) {
      const totalReadingTime = dayjs.duration(totalReadingTimeMinutes, 'minutes').format('HH:mm:ss');
      console.log(`\nTotal: ${results.length} file(s)`);
      console.log(`Total word count: ${totalWordCount.toLocaleString()}`);
      console.log(`Total page count: ${totalPageCount.toLocaleString()}`);
      console.log(`Total reading time: ${totalReadingTime}`);
    }
  } catch (error) {
    // spinner.fail(error.message);
  }
}

const input = argv._[0] || '.';
processFiles(input);