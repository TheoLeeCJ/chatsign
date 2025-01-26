const pdf = require('pdf-parse');
const WordExtractor = require('word-extractor');
const fs = require("fs");

async function extractText(fileBuffer, fileExtension) {
  switch (fileExtension.toLowerCase()) {
    case 'pdf': {
      const pdfData = await pdf(fileBuffer);
      return pdfData.text;
    }

    case 'doc':
    case 'docx': {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(fileBuffer);
      return extracted.getBody();
    }

    case 'txt':
    case "rtf":
    case 'csv':
    case 'json': {
      return fileBuffer.toString();
    }

    default:
      throw new Error(`Unsupported extension: ${fileExtension}`);
  }
}

async function parseFieldMarkers(text) {
  // Looks for [SIGNATURE 1], [SIGNATURE 2], [DATE 1], [TEXT 1A], etc.
  // Returns an object with info about all found fields.
  //
  // You can refine these regex patterns as needed.
  const signaturePattern = /\[SIGNATURE\s+(\d+)\]/gi;
  const datePattern = /\[DATE\s+(\d+)\]/gi;
  const textPattern = /\[TEXT\s+(\d+)([A-Za-z]+)\]/gi;
  
  let match;
  let maxRecipientIndex = 0;

  const signatures = [];
  while ((match = signaturePattern.exec(text)) !== null) {
    signatures.push(match[0]);
    const number = parseInt(match[1], 10);
    if (number > maxRecipientIndex) maxRecipientIndex = number;
  }

  const dates = [];
  while ((match = datePattern.exec(text)) !== null) {
    dates.push(match[0]);
    const number = parseInt(match[1], 10);
    if (number > maxRecipientIndex) maxRecipientIndex = number;
  }

  const texts = [];
  while ((match = textPattern.exec(text)) !== null) {
    texts.push(match[0]);
    const number = parseInt(match[1], 10);
    if (number > maxRecipientIndex) maxRecipientIndex = number;
  }

  return {
    maxRecipientIndex,
    signatures,
    dates,
    texts,
  };
}

async function docSetupPageHtml(docRow) {
  const fieldsExtracted = JSON.parse(docRow.fieldsJson);
  const { maxRecipientIndex, signatures, dates, texts } = fieldsExtracted;
  
  // Minimal example of a form that asks the user for recipient details
  return fs.readFileSync("pages/docSetup.html").toString().replaceAll('{{maxRecipientIndex}}', maxRecipientIndex)
    .replace('{{JSON.stringify(signatures)}}', JSON.stringify(signatures))
    .replace('{{JSON.stringify(dates)}}', JSON.stringify(dates))
    .replace('{{JSON.stringify(texts)}}', JSON.stringify(texts))
    .replace('{{filename}}', docRow.originalFileName)
    .replace('{{fileId}}', docRow.id);
}

module.exports = { extractText, parseFieldMarkers, docSetupPageHtml };