#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const Table = require('cli-table3');
const textract = require('textract');
const util = require('util');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const ora = require('ora');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const colors = require('@colors/colors');


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
  console.error('Invalid wpm value');
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
    return { wordCount: 0, pageCount: 0 };
  }

  const words = text.trim().split(/\s+/);
  return { wordCount: words.length, pageCount };
}

async function getFileStats(filePath) {
  const { wordCount, pageCount } = await getWordCount(filePath);
  const readingTimeMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);

  const hours = Math.floor(readingTimeMinutes / 60);
  const minutes = readingTimeMinutes % 60;
  const readingTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;

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
  const spinner = ora('Processing documents...').start();

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
      spinner.fail('No supported documents found');
      return;
    }

    const results = await Promise.all(files.map(getFileStats));

    if (argv.timesort && results.length > 1) {
      results.sort((a, b) => b.readingTimeMinutes - a.readingTimeMinutes);
    }

    const table = new Table({
      head: ['#', 'File', 'Format', 'Pages', 'Reading Time']
      .map((content) => ({ content: colors.bold(content) })),
      style: {
        head: ['cyan'],
      },
      colWidths: [5, 60],
      wordWrap: true,
      wrapWords: true,
      wrapOnWordBoundary: true,
    });

    let totalPageCount = 0;
    let totalMinutes = 0;

    results.forEach((result, index) => {
      table.push([
        colors.bold(index + 1),
        colors.bold(result.file),
        result.format,
        result.pageCount.toLocaleString(),
        result.readingTime
      ]);
      totalPageCount += result.pageCount;
      totalMinutes += result.readingTimeMinutes;
    });

    spinner.stop();
    console.log(table.toString());

    if (results.length > 1) {
      // Calculate total hours and remaining minutes
      const totalHours = Math.floor(totalMinutes / 60);
      const remainingMinutes = Math.floor(totalMinutes % 60);

      const totalReadingTime = `${totalHours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}:00`;
      
      console.log(`\nTotal: ${results.length} documents`);
      console.log(`Total page count: ${totalPageCount.toLocaleString()}`);
      console.log(`Total reading time: ${totalReadingTime}`);
    }
  } catch (error) {
    spinner.fail(error.message);
  }
}

const input = argv._[0] || '.';
processFiles(input);