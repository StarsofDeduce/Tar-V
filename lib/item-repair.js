'use strict';

const path = require('path');

function normalizeRepairName(value) {
  return String(value || '')
    .toLocaleLowerCase('en-US')
    .replace(/\.(exe|lnk|url)$/i, '')
    .replace(/(?:shortcut|快捷方式)$/i, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, '');
}

function comparableBaseName(value) {
  if (!value || typeof value !== 'string') return '';
  const withoutQuery = value.split(/[?#]/, 1)[0];
  return normalizeRepairName(path.basename(withoutQuery));
}

function relatedName(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 2;
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) return 1;
  return 0;
}

function scoreRepairCandidate(item, candidate) {
  if (!item || !candidate || !candidate.target) return 0;
  const itemName = normalizeRepairName(item.name);
  const shortcutName = normalizeRepairName(candidate.name || candidate.shortcutPath);
  const oldBase = comparableBaseName(item.path);
  const targetBase = comparableBaseName(candidate.target);
  let score = 0;

  const shortcutRelation = relatedName(itemName, shortcutName);
  score += shortcutRelation === 2 ? 70 : shortcutRelation === 1 ? 40 : 0;

  const executableRelation = relatedName(oldBase, targetBase);
  score += executableRelation === 2 ? 60 : executableRelation === 1 ? 30 : 0;

  const targetNameRelation = relatedName(itemName, targetBase);
  score += targetNameRelation === 2 ? 50 : targetNameRelation === 1 ? 25 : 0;

  const oldExtension = path.extname(String(item.path || '')).toLowerCase();
  const newExtension = path.extname(String(candidate.target || '')).toLowerCase();
  if (oldExtension && oldExtension === newExtension) score += 10;
  if (candidate.shortcutPath) score += 5;
  return score;
}

function chooseUniqueRepairCandidate(item, candidates, { minimumScore = 70, minimumMargin = 20 } = {}) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, score: scoreRepairCandidate(item, candidate) }))
    .filter((entry) => entry.score >= minimumScore)
    .sort((a, b) => b.score - a.score || String(a.candidate.shortcutPath).localeCompare(String(b.candidate.shortcutPath)));

  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < minimumMargin) return null;
  return { ...ranked[0].candidate, score: ranked[0].score };
}

module.exports = {
  normalizeRepairName,
  scoreRepairCandidate,
  chooseUniqueRepairCandidate
};
