import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidateDirectory = path.join(projectRoot, 'scratch', 'asset-optimization', 'candidates');
const reportPath = path.join(projectRoot, 'scratch', 'asset-optimization', 'report.json');
const minimumSavings = 0.05;
const assets = [
  'login-error-help-illustration-v10.png',
  'auth-error-reminder-handlettered-v5.png',
  'mobile-login-reminder-handlettered-v8.png',
  'maker-credit-watercolor-v1.png'
];

async function rawPixels(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

async function optimizeAsset(fileName) {
  const sourcePath = path.join(projectRoot, 'assets', fileName);
  const candidateName = fileName.replace(/\.png$/i, '.optimized.png');
  const candidatePath = path.join(candidateDirectory, candidateName);
  const sourceBytes = (await readFile(sourcePath)).byteLength;

  const sourceMetadata = await sharp(sourcePath).metadata();
  const candidateBuffer = await sharp(sourcePath)
    .withMetadata({ density: sourceMetadata.density })
    .png({ compressionLevel: 9, adaptiveFiltering: true, progressive: false })
    .toBuffer();
  await writeFile(candidatePath, candidateBuffer);

  const candidateBytes = (await readFile(candidatePath)).byteLength;
  const [source, candidate] = await Promise.all([rawPixels(sourcePath), rawPixels(candidatePath)]);
  const pixelIdentical = source.info.width === candidate.info.width
    && source.info.height === candidate.info.height
    && source.info.channels === candidate.info.channels
    && source.data.equals(candidate.data);
  const savingsRatio = (sourceBytes - candidateBytes) / sourceBytes;

  if (!pixelIdentical) {
    throw new Error(`${fileName} failed the pixel-identical check.`);
  }

  return {
    source: `assets/${fileName}`,
    candidate: `scratch/asset-optimization/candidates/${candidateName}`,
    sourceBytes,
    candidateBytes,
    savingsBytes: sourceBytes - candidateBytes,
    savingsPercent: Number((savingsRatio * 100).toFixed(2)),
    dimensions: `${source.info.width}x${source.info.height}`,
    pixelIdentical,
    accepted: savingsRatio >= minimumSavings
  };
}

await mkdir(candidateDirectory, { recursive: true });
const results = [];
for (const asset of assets) results.push(await optimizeAsset(asset));
await writeFile(reportPath, `${JSON.stringify({ minimumSavingsPercent: minimumSavings * 100, results }, null, 2)}\n`);

for (const result of results) {
  const outcome = result.accepted ? 'ACCEPT' : 'KEEP PNG';
  console.log(`${outcome} ${result.source}: ${result.savingsPercent}% (${result.sourceBytes} -> ${result.candidateBytes} bytes)`);
}
