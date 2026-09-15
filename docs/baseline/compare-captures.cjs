const fs = require('node:fs/promises');
const path = require('node:path');

const sharpRoot = process.env.AA_SHARP_MODULE ||
  'C:\\Users\\saqla\\Desktop\\InsideSuccess\\marketing tool\\local\\stakeholder-integration\\frontend\\frontend\\node_modules\\sharp';
const sharp = require(sharpRoot);

const baselineRoot = path.resolve(process.env.AA_BASELINE_SCREENSHOTS || path.join(__dirname, 'screenshots'));
const candidateRoot = path.resolve(process.env.AA_CANDIDATE_SCREENSHOTS || path.join(__dirname, '..', 'migration', 'screenshots'));
const reportPath = path.resolve(process.env.AA_COMPARE_REPORT || path.join(__dirname, '..', 'migration', 'visual-comparison.json'));
const diffRoot = path.resolve(process.env.AA_DIFF_OUTPUT || path.join(__dirname, '..', 'migration', 'diffs'));
const channelThreshold = Number(process.env.AA_CHANNEL_THRESHOLD || 16);

async function compare(file) {
  const baseline = await sharp(path.join(baselineRoot, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const candidate = await sharp(path.join(candidateRoot, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (baseline.info.width !== candidate.info.width || baseline.info.height !== candidate.info.height) {
    return {
      file,
      comparable: false,
      baseline: { width: baseline.info.width, height: baseline.info.height },
      candidate: { width: candidate.info.width, height: candidate.info.height },
    };
  }

  let absolute = 0;
  let changedPixels = 0;
  const diff = Buffer.alloc(baseline.data.length);
  for (let offset = 0; offset < baseline.data.length; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(baseline.data[offset + channel] - candidate.data[offset + channel]);
      absolute += delta;
      if (delta > channelThreshold) pixelChanged = true;
    }
    if (pixelChanged) changedPixels += 1;
    const visible = pixelChanged ? 255 : 0;
    diff[offset] = visible;
    diff[offset + 1] = 0;
    diff[offset + 2] = visible;
    diff[offset + 3] = pixelChanged ? 255 : 0;
  }

  const pixels = baseline.info.width * baseline.info.height;
  const changedPercent = (changedPixels / pixels) * 100;
  if (changedPixels) {
    await sharp(diff, {
      raw: { width: baseline.info.width, height: baseline.info.height, channels: 4 },
    }).png().toFile(path.join(diffRoot, file));
  }
  return {
    file,
    comparable: true,
    width: baseline.info.width,
    height: baseline.info.height,
    changedPixels,
    changedPercent,
    meanAbsoluteChannelDifference: absolute / (pixels * 3),
  };
}

async function main() {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.rm(diffRoot, { recursive: true, force: true });
  await fs.mkdir(diffRoot, { recursive: true });
  const files = (await fs.readdir(baselineRoot)).filter((file) => file.endsWith('.png')).sort();
  const candidateFiles = new Set((await fs.readdir(candidateRoot)).filter((file) => file.endsWith('.png')));
  const missing = files.filter((file) => !candidateFiles.has(file));
  const extra = [...candidateFiles].filter((file) => !files.includes(file)).sort();
  const comparisons = [];
  for (const file of files.filter((name) => candidateFiles.has(name))) {
    const result = await compare(file);
    comparisons.push(result);
    process.stdout.write(`${file}: ${result.comparable ? result.changedPercent.toFixed(4) + '%' : 'dimension mismatch'}\n`);
  }
  const report = {
    comparedAt: new Date().toISOString(),
    baselineRoot,
    candidateRoot,
    channelThreshold,
    missing,
    extra,
    comparisons,
    summary: {
      baselineFiles: files.length,
      candidateFiles: candidateFiles.size,
      comparable: comparisons.filter((item) => item.comparable).length,
      dimensionMismatches: comparisons.filter((item) => !item.comparable).length,
      exact: comparisons.filter((item) => item.comparable && item.changedPixels === 0).length,
      maxChangedPercent: Math.max(0, ...comparisons.filter((item) => item.comparable).map((item) => item.changedPercent)),
      meanChangedPercent: comparisons.length
        ? comparisons.filter((item) => item.comparable).reduce((sum, item) => sum + item.changedPercent, 0) / comparisons.length
        : 0,
    },
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (missing.length || extra.length || report.summary.dimensionMismatches) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
