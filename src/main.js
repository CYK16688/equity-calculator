import './style.css';
import { equityData as starterData } from './equity-data.js';
import {
  assessOwnership,
  parseOwnershipPercent as parsePercent,
  relationHasOwnershipError
} from './ownership-validation.js';
import {
  calculateDilutionPlan,
  calculateDilutionPlanFromNewIssuePercent,
  calculateNewIssuePercentFromValuation
} from './financing.js';
import { calculateOwnershipQuery } from './ownership-query.js';
import {
  nodeDisplayLabel,
  suggestUniqueNodeName,
  zoomInScale,
  zoomOutScale
} from './graph-ui-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'local-equity-editor-v1';
const VIEW_WIDTH = 1600;
const VIEW_HEIGHT = 1000;
const SNAP_THRESHOLD = 10;
const GRID_SIZE = 20;
const DEFAULT_WATERMARK_TEXT = 'ownership studio';

const svg = document.getElementById('equity-graph');
const canvasWrap = document.getElementById('canvas-wrap');
const nodeList = document.getElementById('node-list');
const nodeEditor = document.getElementById('node-editor');
const linkEditor = document.getElementById('link-editor');
const inspectorEmpty = document.getElementById('inspector-empty');
const toastElement = document.getElementById('toast');
const saveStatus = document.getElementById('save-status');
const zoomValue = document.getElementById('zoom-value');
const inlineNodeEditor = document.getElementById('inline-node-editor');
const inlineNodeName = document.getElementById('inline-node-name');
const inlineRelationEditor = document.getElementById('inline-relation-editor');
const inlineRelationPercent = document.getElementById('inline-relation-percent');
const financingWorkspace = document.getElementById('financing-workspace');
const financingGate = document.getElementById('financing-gate');
const financingPreview = document.getElementById('financing-preview');
const financingPreviewTable = document.getElementById('financing-preview-table');
const ownershipQueryResultElement = document.getElementById('ownership-query-result');
const watermarkEditor = document.getElementById('watermark-editor');
const watermarkTextInput = document.getElementById('watermark-text');
const editWatermarkButton = document.getElementById('edit-watermark');

const deepCopy = value => JSON.parse(JSON.stringify(value));

function formatPercent(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
  return `${rounded.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}%`;
}

function inferFinancingNewIssuePercent(event) {
  const explicit = Number(event?.newIssuePercent);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const finalPercent = Number(event?.postMoneyPercent);
  if (!Number.isFinite(finalPercent) || finalPercent <= 0) return 0;
  const existing = Array.isArray(event?.before)
    ? event.before.find(row => String(row.id) === String(event.investorId))
    : null;
  const existingPercent = Number(existing?.percent) || 0;
  if (existingPercent <= 0 || existingPercent >= 100) return finalPercent;
  return 100 * (finalPercent - existingPercent) / (100 - existingPercent);
}

function normalizeWatermarkText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || DEFAULT_WATERMARK_TEXT;
}

function normalizeData(candidate) {
  if (!candidate || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.links)) {
    throw new Error('JSON 必须包含 nodes 和 links 数组');
  }
  const data = deepCopy(candidate);
  data.settings = {
    ...(data.settings && typeof data.settings === 'object' ? data.settings : {}),
    watermarkText: normalizeWatermarkText(data.settings?.watermarkText ?? data.watermarkText)
  };
  data.nodes = data.nodes.map((node, index) => ({
    id: String(node.id || `node-${index + 1}`),
    name: String(node.name || node.text || `未命名主体 ${index + 1}`),
    type: String(node.type || '其他主体'),
    code: String(node.code || ''),
    note: String(node.note || ''),
    ownershipScope: node.ownershipScope === 'complete' ? 'complete' : 'partial',
    root: Boolean(node.root),
    ribbon: node.ribbon || null,
    x: Number.isFinite(Number(node.x)) ? Number(node.x) : 120 + (index % 5) * 270,
    y: Number.isFinite(Number(node.y)) ? Number(node.y) : 100 + Math.floor(index / 5) * 200
  }));
  const nodeIds = data.nodes.map(node => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error('nodes 中存在重复主体 ID，请先合并或修正');
  const validIds = new Set(data.nodes.map(node => node.id));
  const usedRelationIds = new Set();
  data.links = data.links
    .filter(link => validIds.has(String(link.from)) && validIds.has(String(link.to)))
    .map((link, index) => {
      const preferredId = String(link.id || `relation-${index + 1}`);
      let id = preferredId;
      let suffix = 2;
      while (usedRelationIds.has(id)) {
        id = `${preferredId}-${suffix}`;
        suffix += 1;
      }
      usedRelationIds.add(id);
      return {
        id,
        from: String(link.from),
        to: String(link.to),
        percent: String(link.percent || link.text || '0%')
      };
    });
  data.financingEvents = (Array.isArray(data.financingEvents) ? data.financingEvents : []).map((event, index) => ({
    id: String(event.id || `financing-${index + 1}`),
    companyId: String(event.companyId || ''),
    investorId: String(event.investorId || ''),
    investorName: String(event.investorName || ''),
    round: String(event.round || '新一轮融资'),
    date: String(event.date || ''),
    mode: event.mode === 'valuation' ? 'valuation' : 'percent',
    status: 'simulated',
    currency: ['CNY', 'USD', 'HKD'].includes(event.currency) ? event.currency : null,
    postMoneyPercent: Number(event.postMoneyPercent) || 0,
    newIssuePercent: inferFinancingNewIssuePercent(event),
    preMoneyValuation: Number(event.preMoneyValuation) || null,
    investmentAmount: Number(event.investmentAmount) || null,
    before: Array.isArray(event.before) ? deepCopy(event.before) : [],
    after: Array.isArray(event.after) ? deepCopy(event.after) : [],
    createdAt: String(event.createdAt || new Date().toISOString())
  }));
  return data;
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeData(JSON.parse(saved)) : normalizeData(starterData);
  } catch (error) {
    console.warn('本地数据读取失败，已恢复示例数据。', error);
    return normalizeData(starterData);
  }
}

let graphData = loadData();
let selected = null;
let historyStack = [];
let redoStack = [];
let searchTerm = '';
let listViewMode = 'tree';
let sidebarMode = 'subjects';
const collapsedLayers = new Set();
let toastTimer = null;
let inlineEditingNodeId = null;
let inlineBlurGuardUntil = 0;
let inlineEditingRelationId = null;
let inlineRelationBlurGuardUntil = 0;
let lastNodeClick = { id: null, time: 0 };
let financingOpenNodeId = null;
let currentFinancingPlan = null;
let ownershipQuerySourceId = null;
let ownershipQueryTargetId = null;
let ownershipQueryPickRole = 'source';
let currentOwnershipQuery = null;
let ownershipQueryFocusedPath = null;
let watermarkDraftText = null;

const view = {
  scale: 0.82,
  x: 110,
  y: 60,
  showWatermark: true,
  snapEnabled: true,
  snapGuides: null,
  panning: null,
  nodeDrag: null,
  linkDraft: null,
  justDragged: false
};

function nodeMap() {
  return new Map(graphData.nodes.map(node => [node.id, node]));
}

function canEditGraph() {
  return sidebarMode !== 'query';
}

function relationMap() {
  return new Map(graphData.links.map(link => [link.id, link]));
}

function getOwnershipSummary(nodeId) {
  const node = nodeMap().get(nodeId);
  const incoming = graphData.links.filter(link => link.to === nodeId);
  return assessOwnership(node, incoming);
}

function ownershipIssueCodes(entries) {
  return new Set(entries.map(entry => entry.code));
}

function getOwnershipPresentation(node, ownership) {
  const errors = ownershipIssueCodes(ownership.errors);
  const warnings = ownershipIssueCodes(ownership.warnings);

  if (errors.has('NATURAL_PERSON_AS_INVESTEE')) {
    return { state: 'error', tone: 'danger', text: '错误：自然人不能作为股权关系的被投主体，请调整箭头方向' };
  }
  if (errors.has('INVALID_PERCENT_FORMAT')) {
    return { state: 'error', tone: 'danger', text: `错误：存在 ${ownership.invalidFormatIncoming.length} 条无法识别的持股比例` };
  }
  if (errors.has('NON_POSITIVE_PERCENT')) {
    return { state: 'error', tone: 'danger', text: `错误：存在 ${ownership.nonPositiveIncoming.length} 条小于或等于 0% 的持股关系` };
  }
  if (errors.has('RELATION_PERCENT_OVER_100')) {
    return { state: 'error', tone: 'danger', text: `错误：存在 ${ownership.overLimitIncoming.length} 条超过 100% 的单笔持股关系` };
  }
  if (errors.has('SELF_OWNERSHIP')) {
    return { state: 'error', tone: 'danger', text: '错误：主体不能通过普通持股关系直接持有自身' };
  }
  if (errors.has('DUPLICATE_SHAREHOLDER')) {
    return { state: 'error', tone: 'danger', text: '错误：同一股东与该企业之间存在重复持股关系，请合并为一条' };
  }
  if (errors.has('TOTAL_OVER_100')) {
    return { state: 'error', tone: 'danger', text: `错误：已录入持股合计超过 100%，超出 ${formatPercent(ownership.total - 100)}` };
  }
  if (errors.has('COMPLETE_CAP_TABLE_UNDER_100')) {
    return { state: 'error', tone: 'danger', text: `错误：已声明为完整股东名册，仍有 ${formatPercent(100 - ownership.total)} 未分配` };
  }
  if (warnings.has('WHOLLY_OWNED_TYPE_MISMATCH')) {
    return { state: 'warning', tone: 'warning', text: '提示：主体标记为“全资子公司”，但当前并非单一股东持股 100%，请核对主体类型或股权数据' };
  }
  if (warnings.has('CONTROLLED_TYPE_NEEDS_BASIS')) {
    return { state: 'warning', tone: 'warning', text: '提示：当前没有单一股东持股超过 50%；如属于协议控制，请在备注中说明控制依据' };
  }
  if (warnings.has('MINORITY_TYPE_MISMATCH')) {
    return { state: 'warning', tone: 'warning', text: '提示：主体标记为“参股企业”，但存在持股超过 50% 的股东，请核对主体类型' };
  }
  if (node.type.includes('自然人') && !ownership.incoming.length) {
    return { state: 'empty', tone: 'empty', text: '自然人股东无需配置上游持股' };
  }
  if (ownership.notices.some(notice => notice.code === 'ROUNDING_TOLERANCE_APPLIED')) {
    return { state: 'warning', tone: 'warning', text: `提示：持股合计为 ${formatPercent(ownership.total)}，按录入精度视为 100% 的舍入差异` };
  }
  if (ownership.complete) {
    return {
      state: 'ok',
      tone: 'ok',
      text: ownership.scope === 'complete'
        ? '完整股东名册合计 100%，比例校验通过'
        : '已录入持股合计 100%，当前数据内部一致'
    };
  }
  if (!ownership.incoming.length) {
    return { state: 'empty', tone: 'empty', text: '尚未录入该主体的股东数据，不视为比例错误' };
  }
  return {
    state: 'notice',
    tone: 'warning',
    text: `当前为部分披露口径：已录入 ${formatPercent(ownership.total)}，其余 ${formatPercent(ownership.undisclosed)} 记为未披露股东`
  };
}

function positionInlineNodeEditor() {
  if (!inlineEditingNodeId || inlineNodeEditor.hidden) return;
  const group = [...svg.querySelectorAll('.graph-node')]
    .find(element => element.dataset.nodeId === inlineEditingNodeId);
  const shape = group?.querySelector(':scope > rect');
  if (!shape) {
    inlineNodeEditor.hidden = true;
    inlineEditingNodeId = null;
    return;
  }
  const nodeRect = shape.getBoundingClientRect();
  const wrapRect = canvasWrap.getBoundingClientRect();
  inlineNodeEditor.style.left = `${nodeRect.left - wrapRect.left}px`;
  inlineNodeEditor.style.top = `${nodeRect.top - wrapRect.top}px`;
  inlineNodeEditor.style.width = `${nodeRect.width}px`;
  inlineNodeEditor.style.height = `${nodeRect.height}px`;
  inlineNodeName.style.fontSize = `${Math.max(10, Math.min(15, nodeRect.height / 4.7))}px`;
}

function positionInlineRelationEditor() {
  if (!inlineEditingRelationId || inlineRelationEditor.hidden) return;
  const group = [...svg.querySelectorAll('.relation-label-group')]
    .find(element => element.dataset.relationId === inlineEditingRelationId);
  const label = group?.querySelector('.relation-label-box');
  if (!label) {
    inlineRelationEditor.hidden = true;
    inlineEditingRelationId = null;
    return;
  }
  const labelRect = label.getBoundingClientRect();
  const wrapRect = canvasWrap.getBoundingClientRect();
  const width = Math.max(88, labelRect.width + 20);
  const height = Math.max(38, labelRect.height + 10);
  inlineRelationEditor.style.left = `${labelRect.left - wrapRect.left + labelRect.width / 2 - width / 2}px`;
  inlineRelationEditor.style.top = `${labelRect.top - wrapRect.top + labelRect.height / 2 - height / 2}px`;
  inlineRelationEditor.style.width = `${width}px`;
  inlineRelationEditor.style.height = `${height}px`;
}

function cancelInlineNodeEdit() {
  inlineEditingNodeId = null;
  inlineNodeEditor.hidden = true;
}

function cancelInlineRelationEdit() {
  inlineEditingRelationId = null;
  inlineRelationEditor.hidden = true;
}

function saveInlineNodeEdit() {
  if (!inlineEditingNodeId) return;
  const id = inlineEditingNodeId;
  const node = nodeMap().get(id);
  const name = inlineNodeName.value.trim();
  if (!name) {
    showToast('主体名称不能为空', 'warning');
    inlineNodeName.focus();
    return;
  }
  cancelInlineNodeEdit();
  if (!node || node.name === name) return;
  commit('节点名称已直接更新', () => {
    const currentNode = nodeMap().get(id);
    if (currentNode) currentNode.name = name;
  });
}

function startInlineNodeEdit(id) {
  if (!canEditGraph()) return;
  const node = nodeMap().get(id);
  if (!node) return;
  cancelInlineRelationEdit();
  cancelInlineNodeEdit();
  selected = { kind: 'node', id };
  renderAll();
  inlineEditingNodeId = id;
  inlineNodeName.value = node.name;
  inlineNodeEditor.dataset.root = String(node.root);
  inlineNodeEditor.dataset.error = String(getOwnershipSummary(id).error);
  inlineNodeEditor.hidden = false;
  inlineBlurGuardUntil = performance.now() + 350;
  positionInlineNodeEditor();
  inlineNodeName.focus();
  inlineNodeName.select();
}

function saveInlineRelationEdit() {
  if (!inlineEditingRelationId) return;
  const id = inlineEditingRelationId;
  const relation = relationMap().get(id);
  const percent = Number(inlineRelationPercent.value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    showToast('持股比例必须在 0% 到 100% 之间', 'warning');
    inlineRelationPercent.focus();
    inlineRelationPercent.select();
    return;
  }
  cancelInlineRelationEdit();
  if (!relation || parsePercent(relation.percent) === percent) return;
  commit('持股比例已直接更新', () => {
    const currentRelation = relationMap().get(id);
    if (currentRelation) currentRelation.percent = formatPercent(percent);
  });
}

function startInlineRelationEdit(id) {
  if (!canEditGraph()) return;
  const relation = relationMap().get(id);
  if (!relation) return;
  cancelInlineNodeEdit();
  cancelInlineRelationEdit();
  selected = { kind: 'link', id };
  renderAll();
  inlineEditingRelationId = id;
  inlineRelationPercent.value = String(parsePercent(relation.percent));
  inlineRelationEditor.dataset.error = String(getOwnershipSummary(relation.to).error);
  inlineRelationEditor.hidden = false;
  inlineRelationBlurGuardUntil = performance.now() + 220;
  positionInlineRelationEditor();
  inlineRelationPercent.focus();
  inlineRelationPercent.select();
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(graphData));
  saveStatus.innerHTML = '<i></i> 已保存到本机';
  saveStatus.classList.remove('saving');
}

function markSaving() {
  saveStatus.innerHTML = '<i></i> 正在保存';
  saveStatus.classList.add('saving');
}

function showToast(message, tone = 'success') {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.dataset.tone = tone;
  toastElement.classList.add('show');
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2200);
}

function updateHistoryButtons() {
  document.getElementById('undo').disabled = historyStack.length === 0;
  document.getElementById('redo').disabled = redoStack.length === 0;
}

function captureView() {
  return { scale: view.scale, x: view.x, y: view.y };
}

function restoreView(snapshot) {
  if (!snapshot) return;
  view.scale = snapshot.scale;
  view.x = snapshot.x;
  view.y = snapshot.y;
}

function createHistoryEntry(includeView = false, data = graphData) {
  return { data: deepCopy(data), view: includeView ? captureView() : null };
}

function commit(message, mutate, { includeView = false } = {}) {
  historyStack.push(createHistoryEntry(includeView));
  if (historyStack.length > 60) historyStack.shift();
  redoStack = [];
  markSaving();
  mutate();
  graphData = normalizeData(graphData);
  saveData();
  renderAll();
  updateHistoryButtons();
  showToast(message);
}

function undo() {
  if (!historyStack.length) return;
  const previous = historyStack.pop();
  redoStack.push(createHistoryEntry(Boolean(previous.view)));
  graphData = previous.data;
  restoreView(previous.view);
  validateSelection();
  saveData();
  renderAll();
  updateHistoryButtons();
  showToast('已撤销上一步');
}

function redo() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  historyStack.push(createHistoryEntry(Boolean(next.view)));
  graphData = next.data;
  restoreView(next.view);
  validateSelection();
  saveData();
  renderAll();
  updateHistoryButtons();
  showToast('已恢复操作');
}

function validateSelection() {
  if (!selected) return;
  const exists = selected.kind === 'node'
    ? graphData.nodes.some(node => node.id === selected.id)
    : graphData.links.some(link => link.id === selected.id);
  if (!exists) selected = null;
}

function createSvgElement(name, attributes = {}, text = '') {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
}

function nodeDimensions(node) {
  return node.root ? { width: 330, height: 76 } : { width: 220, height: 88 };
}

function addDefinitions() {
  const defs = createSvgElement('defs');
  [
    ['arrow', '#b7bfcb'],
    ['arrow-active', '#156ef1'],
    ['arrow-query', '#11816c'],
    ['arrow-error', '#dc2626']
  ].forEach(([id, fill]) => {
    const marker = createSvgElement('marker', {
      id, viewBox: '0 0 10 10', refX: '8', refY: '5',
      markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse'
    });
    marker.appendChild(createSvgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill }));
    defs.appendChild(marker);
  });
  const shadow = createSvgElement('filter', { id: 'node-shadow', x: '-30%', y: '-30%', width: '160%', height: '180%' });
  shadow.appendChild(createSvgElement('feDropShadow', {
    dx: '0', dy: '7', stdDeviation: '8', 'flood-color': '#17345b', 'flood-opacity': '.16'
  }));
  defs.appendChild(shadow);
  svg.appendChild(defs);
}

function drawWatermarks(stage) {
  if (!view.showWatermark) return;
  const watermarkText = watermarkDraftText ?? graphData.settings.watermarkText;
  if (!watermarkText) return;
  for (let y = 140; y < 950; y += 260) {
    for (let x = 140; x < 1550; x += 350) {
      stage.appendChild(createSvgElement('text', {
        x, y, fill: '#efbd78', opacity: '.17', 'font-size': '18', 'font-weight': '800',
        transform: `rotate(-36 ${x} ${y})`
      }, watermarkText));
    }
  }
}

function drawSnapGuides(stage) {
  if (!view.snapGuides) return;
  const guideGroup = createSvgElement('g', { class: 'snap-guides', 'aria-hidden': 'true' });
  const { vertical, horizontal } = view.snapGuides;
  if (vertical) {
    guideGroup.appendChild(createSvgElement('line', {
      class: 'snap-guide-line', x1: vertical.position, x2: vertical.position,
      y1: vertical.start, y2: vertical.end, 'vector-effect': 'non-scaling-stroke'
    }));
    guideGroup.appendChild(createSvgElement('text', {
      class: 'snap-guide-label', x: vertical.position + 8, y: vertical.start + 16
    }, vertical.label));
  }
  if (horizontal) {
    guideGroup.appendChild(createSvgElement('line', {
      class: 'snap-guide-line', x1: horizontal.start, x2: horizontal.end,
      y1: horizontal.position, y2: horizontal.position, 'vector-effect': 'non-scaling-stroke'
    }));
    guideGroup.appendChild(createSvgElement('text', {
      class: 'snap-guide-label', x: horizontal.start + 8, y: horizontal.position - 8
    }, horizontal.label));
  }
  stage.appendChild(guideGroup);
}

function getSnappedPosition(draggedNode, proposedX, proposedY) {
  if (!view.snapEnabled) {
    return { x: Math.round(proposedX), y: Math.round(proposedY), guides: null };
  }
  const draggedSize = nodeDimensions(draggedNode);
  let bestX = null;
  let bestY = null;

  graphData.nodes.forEach(other => {
    if (other.id === draggedNode.id) return;
    const otherSize = nodeDimensions(other);
    const distance = Math.hypot(
      proposedX + draggedSize.width / 2 - (other.x + otherSize.width / 2),
      proposedY + draggedSize.height / 2 - (other.y + otherSize.height / 2)
    );
    if (distance > 600) return;

    const xCandidates = [
      { moving: proposedX, target: other.x, snapped: other.x, label: '左边缘对齐' },
      { moving: proposedX + draggedSize.width / 2, target: other.x + otherSize.width / 2, snapped: other.x + otherSize.width / 2 - draggedSize.width / 2, label: '中心对齐' },
      { moving: proposedX + draggedSize.width, target: other.x + otherSize.width, snapped: other.x + otherSize.width - draggedSize.width, label: '右边缘对齐' }
    ];
    xCandidates.forEach(candidate => {
      const delta = Math.abs(candidate.moving - candidate.target);
      if (delta <= SNAP_THRESHOLD && (!bestX || delta < bestX.delta)) {
        bestX = { ...candidate, delta, other, otherSize };
      }
    });

    const yCandidates = [
      { moving: proposedY, target: other.y, snapped: other.y, label: '顶边对齐' },
      { moving: proposedY + draggedSize.height / 2, target: other.y + otherSize.height / 2, snapped: other.y + otherSize.height / 2 - draggedSize.height / 2, label: '同层居中' },
      { moving: proposedY + draggedSize.height, target: other.y + otherSize.height, snapped: other.y + otherSize.height - draggedSize.height, label: '底边对齐' }
    ];
    yCandidates.forEach(candidate => {
      const delta = Math.abs(candidate.moving - candidate.target);
      if (delta <= SNAP_THRESHOLD && (!bestY || delta < bestY.delta)) {
        bestY = { ...candidate, delta, other, otherSize };
      }
    });
  });

  const x = bestX ? bestX.snapped : Math.round(proposedX / GRID_SIZE) * GRID_SIZE;
  const y = bestY ? bestY.snapped : Math.round(proposedY / GRID_SIZE) * GRID_SIZE;
  const guides = {
    vertical: bestX ? {
      position: bestX.target,
      start: Math.min(y, bestX.other.y) - 28,
      end: Math.max(y + draggedSize.height, bestX.other.y + bestX.otherSize.height) + 28,
      label: bestX.label
    } : null,
    horizontal: bestY ? {
      position: bestY.target,
      start: Math.min(x, bestY.other.x) - 28,
      end: Math.max(x + draggedSize.width, bestY.other.x + bestY.otherSize.width) + 28,
      label: bestY.label
    } : null
  };
  return { x: Math.round(x), y: Math.round(y), guides: guides.vertical || guides.horizontal ? guides : null };
}

function splitNodeName(name) {
  const explicit = String(name).split('\n').filter(Boolean);
  const lines = [];
  explicit.forEach(part => {
    if (part.length <= 27) {
      lines.push(part);
      return;
    }
    const words = part.split(/\s+/);
    let current = '';
    words.forEach(word => {
      if (`${current} ${word}`.trim().length > 27 && current) {
        lines.push(current);
        current = word;
      } else {
        current = `${current} ${word}`.trim();
      }
    });
    if (current) lines.push(current);
  });
  return lines.slice(0, 4);
}

function drawRibbon(group, node, width) {
  if (!node.ribbon?.tone) return;
  const risk = node.ribbon.tone === 'risk';
  const ribbon = createSvgElement('g', { transform: `translate(${width - 72} 0)` });
  ribbon.appendChild(createSvgElement('path', {
    d: 'M 0 0 H 72 V 22 L 48 0 Z', fill: risk ? '#e52e85' : '#16ad68'
  }));
  ribbon.appendChild(createSvgElement('text', {
    x: 44, y: 12, fill: '#fff', 'font-size': '9', 'font-weight': '800',
    transform: 'rotate(37 44 12)', 'text-anchor': 'middle'
  }, risk ? 'Risk' : 'Controller'));
  group.appendChild(ribbon);
}

function boxesOverlap(a, b, gap = 7) {
  return !(
    a.right + gap <= b.left ||
    a.left >= b.right + gap ||
    a.bottom + gap <= b.top ||
    a.top >= b.bottom + gap
  );
}

function placeRelationLabel(endX, endY, labelWidth, occupiedLabels) {
  // 比例始终锚定在被投企业的箭头入口上方，不因新增其他股东而改变归属位置。
  const anchorX = endX;
  const anchorY = endY - 25;
  const horizontalStep = labelWidth + 18;
  const candidates = [
    [0, 0],
    [0, -34],
    [0, -68],
    [-horizontalStep, 0],
    [horizontalStep, 0],
    [-horizontalStep, -34],
    [horizontalStep, -34]
  ];

  for (const [offsetX, offsetY] of candidates) {
    const x = anchorX + offsetX;
    const y = anchorY + offsetY;
    const box = {
      left: x - labelWidth / 2,
      right: x + labelWidth / 2,
      top: y - 15,
      bottom: y + 13
    };
    if (occupiedLabels.every(existing => !boxesOverlap(box, existing))) {
      occupiedLabels.push(box);
      return { x, y };
    }
  }

  // 极端密集图继续向上阶梯排列。已占用框数量有限，因此总能找到不重叠的位置。
  let step = 3;
  while (true) {
    const x = anchorX;
    const y = anchorY - step * 34;
    const box = {
      left: x - labelWidth / 2,
      right: x + labelWidth / 2,
      top: y - 15,
      bottom: y + 13
    };
    if (occupiedLabels.every(existing => !boxesOverlap(box, existing))) {
      occupiedLabels.push(box);
      return { x, y };
    }
    step += 1;
  }
}

function buildRelationRoutes(nodes) {
  const nodeOrder = new Map(graphData.nodes.map((node, index) => [node.id, index]));
  const incomingByTarget = new Map();
  graphData.links.forEach(relation => {
    if (!incomingByTarget.has(relation.to)) incomingByTarget.set(relation.to, []);
    incomingByTarget.get(relation.to).push(relation);
  });

  const routes = new Map();
  const routeBands = new Map();
  graphData.links.forEach(relation => {
    const from = nodes.get(relation.from);
    const to = nodes.get(relation.to);
    if (!from || !to) return;
    const fromSize = nodeDimensions(from);
    const toSize = nodeDimensions(to);
    const startX = from.x + fromSize.width / 2;
    const startY = from.y + fromSize.height;
    const incoming = incomingByTarget.get(relation.to) || [];
    const incomingIndex = incoming.findIndex(link => link.id === relation.id);
    const endX = incoming.length <= 1
      ? to.x + toSize.width / 2
      : to.x + toSize.width * ((incomingIndex + 1) / (incoming.length + 1));
    const endY = to.y;
    // 同层节点允许少量纵向误差，仍归入同一个路由带，给不同股东分配独立轨道。
    const bandKey = `${Math.round(startY / 80)}:${Math.round(endY / 80)}`;
    const route = { relation, from, to, startX, startY, endX, endY, bandKey };
    routes.set(relation.id, route);
    if (!routeBands.has(bandKey)) routeBands.set(bandKey, []);
    routeBands.get(bandKey).push(route);
  });

  routeBands.forEach(bandRoutes => {
    const sourceIds = [...new Set(bandRoutes.map(route => route.relation.from))]
      .sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
    const sourceLanes = new Map();
    const laneIntervals = [];

    sourceIds.forEach(sourceId => {
      const sourceRoutes = bandRoutes.filter(route => route.relation.from === sourceId);
      const interval = {
        left: Math.min(...sourceRoutes.flatMap(route => [route.startX, route.endX])),
        right: Math.max(...sourceRoutes.flatMap(route => [route.startX, route.endX]))
      };
      let lane = 0;
      while (laneIntervals[lane]?.some(existing => !(
        interval.right + 18 <= existing.left || interval.left >= existing.right + 18
      ))) lane += 1;
      if (!laneIntervals[lane]) laneIntervals[lane] = [];
      laneIntervals[lane].push(interval);
      sourceLanes.set(sourceId, lane);
    });

    const bandStartY = Math.max(...bandRoutes.map(route => route.startY));
    const bandEndY = Math.min(...bandRoutes.map(route => route.endY));
    const bandGap = bandEndY - bandStartY;
    const baseMidY = bandGap > 88
      ? bandStartY + 38
      : bandStartY + Math.max(28, bandGap * .5);
    const maxLane = Math.max(0, ...sourceLanes.values());
    const availableLaneRoom = Math.max(12, bandEndY - 28 - baseMidY);
    const laneSpacing = maxLane > 0 ? Math.min(38, availableLaneRoom / maxLane) : 0;

    bandRoutes.forEach(route => {
      route.laneIndex = sourceLanes.get(route.relation.from) || 0;
      route.midY = baseMidY + route.laneIndex * laneSpacing;
    });
  });

  return routes;
}

function drawRelation(pathStage, labelStage, relation, route, occupiedLabels) {
  if (!route) return;
  const { from, to, startX, startY, endX, endY, midY } = route;
  const active = selected?.kind === 'link' && selected.id === relation.id;
  const fromSelected = selected?.kind === 'node' && selected.id === relation.from;
  const ownershipError = relationHasOwnershipError(getOwnershipSummary(to.id), relation, to);
  const stateClasses = `${active ? ' selected' : ''}${fromSelected ? ' from-selected' : ''}${ownershipError ? ' ownership-error' : ''}`;
  const group = createSvgElement('g', {
    class: `graph-relation${stateClasses}`,
    'data-relation-id': relation.id,
    'data-from-id': relation.from,
    'data-to-id': relation.to,
    role: 'button', tabindex: '0',
    'aria-label': `持股关系 ${nodeDisplayLabel(graphData.nodes, from)} 到 ${nodeDisplayLabel(graphData.nodes, to)} ${relation.percent}`
  });
  const pathData = `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
  group.appendChild(createSvgElement('path', {
    class: 'relation-hitbox', d: pathData, fill: 'none', stroke: 'transparent', 'stroke-width': '16'
  }));
  group.appendChild(createSvgElement('path', {
    class: 'relation-line', d: pathData, fill: 'none',
    stroke: ownershipError ? '#dc2626' : (active ? '#156ef1' : '#bdc5d0'),
    'stroke-width': active ? '3' : '2',
    'marker-end': `url(#${ownershipError ? 'arrow-error' : (active ? 'arrow-active' : 'arrow')})`,
    'vector-effect': 'non-scaling-stroke'
  }));
  group.addEventListener('click', event => {
    event.stopPropagation();
    if (sidebarMode === 'query') {
      showToast('权益查询模式只选择主体，不修改持股关系', 'warning');
      return;
    }
    selectRelation(relation.id);
  });
  group.addEventListener('keydown', event => {
    if (sidebarMode === 'query') return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectRelation(relation.id);
    }
  });
  pathStage.appendChild(group);

  const labelWidth = Math.max(48, relation.percent.length * 9 + 18);
  const { x: labelX, y: labelY } = placeRelationLabel(endX, endY, labelWidth, occupiedLabels);
  const labelGroup = createSvgElement('g', {
    class: `relation-label-group${stateClasses}`,
    'data-relation-id': relation.id,
    'data-from-id': relation.from,
    'data-to-id': relation.to,
    role: 'button', tabindex: '0',
    'aria-label': `修改持股比例 ${nodeDisplayLabel(graphData.nodes, from)} 到 ${nodeDisplayLabel(graphData.nodes, to)} ${relation.percent}`
  });
  labelGroup.appendChild(createSvgElement('rect', {
    class: 'relation-label-box', x: labelX - labelWidth / 2, y: labelY - 15,
    width: labelWidth, height: 28, rx: 7,
    fill: ownershipError ? '#fff1f2' : (active ? '#156ef1' : '#fff'),
    stroke: ownershipError ? '#dc2626' : (active ? '#156ef1' : '#9fa8b6'),
    'stroke-width': ownershipError ? '2' : '1.2'
  }));
  labelGroup.appendChild(createSvgElement('text', {
    class: 'relation-label-text', x: labelX, y: labelY + 4, 'text-anchor': 'middle',
    fill: ownershipError ? '#b91c1c' : (active ? '#fff' : '#263141'),
    'font-size': '13', 'font-weight': '700'
  }, relation.percent));
  labelGroup.addEventListener('click', event => {
    event.stopPropagation();
    if (sidebarMode === 'query') {
      showToast('权益查询模式只选择主体，不修改持股比例', 'warning');
      return;
    }
    startInlineRelationEdit(relation.id);
  });
  labelGroup.addEventListener('keydown', event => {
    if (sidebarMode === 'query') return;
    if (event.key === 'F2' || event.key === 'Enter') {
      event.preventDefault();
      startInlineRelationEdit(relation.id);
    } else if (event.key === ' ') selectRelation(relation.id);
  });
  labelStage.appendChild(labelGroup);
}

function findNodeAtWorldPoint(point, excludedId = null) {
  return [...graphData.nodes].reverse().find(node => {
    if (node.id === excludedId) return false;
    const { width, height } = nodeDimensions(node);
    return point.x >= node.x && point.x <= node.x + width && point.y >= node.y && point.y <= node.y + height;
  }) || null;
}

function drawRelationDraft(stage, nodes) {
  if (!view.linkDraft) return;
  const from = nodes.get(view.linkDraft.from);
  if (!from) return;
  const fromSize = nodeDimensions(from);
  const target = view.linkDraft.targetId ? nodes.get(view.linkDraft.targetId) : null;
  const targetSize = target ? nodeDimensions(target) : null;
  const startX = from.x + fromSize.width / 2;
  const startY = from.y + fromSize.height;
  const endX = target ? target.x + targetSize.width / 2 : view.linkDraft.x;
  const endY = target ? target.y : view.linkDraft.y;
  const distance = endY - startY;
  const midY = distance >= 0
    ? startY + Math.max(30, distance * .5)
    : startY + 30;
  const pathData = `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
  stage.appendChild(createSvgElement('path', { class: 'relation-draft', d: pathData }));
  stage.appendChild(createSvgElement('circle', {
    class: 'relation-draft-start', cx: startX, cy: startY, r: 5
  }));
}

function drawNode(stage, node) {
  const { width, height } = nodeDimensions(node);
  const active = selected?.kind === 'node' && selected.id === node.id;
  const connectionTarget = view.linkDraft?.targetId === node.id;
  const ownership = getOwnershipSummary(node.id);
  const ownershipError = ownership.error;
  const ownershipWarning = ownership.warning;
  const group = createSvgElement('g', {
    class: `graph-node${node.root ? ' root-node' : ''}${active ? ' selected' : ''}${connectionTarget ? ' connection-target' : ''}${ownershipError ? ' ownership-error' : ''}${ownershipWarning ? ' ownership-warning' : ''}`,
    transform: `translate(${node.x} ${node.y})`,
    'data-node-id': node.id, role: 'button', tabindex: '0',
    'aria-label': nodeDisplayLabel(graphData.nodes, node)
  });
  group.appendChild(createSvgElement('rect', {
    width, height, rx: node.root ? 6 : 5,
    fill: ownershipError && !node.root ? '#fff1f2' : (ownershipWarning && !node.root ? '#fffbeb' : (node.root ? '#156ef1' : '#eef4fc')),
    stroke: ownershipError ? '#dc2626' : (ownershipWarning ? '#d97706' : (active ? '#0a57c9' : '#2f7bf1')),
    'stroke-width': active ? '4' : '2',
    filter: active ? 'url(#node-shadow)' : ''
  }));
  const lines = splitNodeName(nodeDisplayLabel(graphData.nodes, node));
  const lineHeight = 19;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2 + 5;
  const text = createSvgElement('text', {
    x: width / 2, y: startY, 'text-anchor': 'middle',
    fill: node.root ? '#fff' : '#111827',
    'font-size': node.root ? '15' : '14', 'font-weight': node.root ? '750' : '580'
  });
  lines.forEach((line, index) => {
    text.appendChild(createSvgElement('tspan', {
      x: width / 2, dy: index === 0 ? 0 : lineHeight
    }, line));
  });
  group.appendChild(text);
  if (ownershipError) {
    group.appendChild(createSvgElement('circle', {
      cx: width - 10, cy: 10, r: 10, fill: '#dc2626', stroke: '#fff', 'stroke-width': '2'
    }));
    group.appendChild(createSvgElement('text', {
      x: width - 10, y: 14, 'text-anchor': 'middle', fill: '#fff', 'font-size': '12', 'font-weight': '900'
    }, '!'));
  } else if (ownershipWarning) {
    group.appendChild(createSvgElement('circle', {
      cx: width - 10, cy: 10, r: 10, fill: '#d97706', stroke: '#fff', 'stroke-width': '2'
    }));
    group.appendChild(createSvgElement('text', {
      x: width - 10, y: 14, 'text-anchor': 'middle', fill: '#fff', 'font-size': '12', 'font-weight': '900'
    }, '!'));
  }
  drawRibbon(group, node, width);

  const connectionHandle = createSvgElement('circle', {
    class: 'connection-handle', cx: width / 2, cy: height + 2, r: 8,
    fill: '#fff', stroke: '#156ef1', 'stroke-width': '3'
  });
  connectionHandle.appendChild(createSvgElement('title', {}, '拖到另一主体，创建持股关系'));
  connectionHandle.addEventListener('pointerdown', event => {
    if (sidebarMode === 'query') return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cancelInlineNodeEdit();
    cancelInlineRelationEdit();
    selectNode(node.id, false);
    const point = clientToWorld(event.clientX, event.clientY);
    view.linkDraft = { from: node.id, x: point.x, y: point.y, targetId: null };
    svg.setPointerCapture(event.pointerId);
    renderGraph();
  });
  connectionHandle.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  group.appendChild(connectionHandle);

  group.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (sidebarMode === 'query') {
      event.preventDefault();
      return;
    }
    const now = Date.now();
    if (lastNodeClick.id === node.id && now - lastNodeClick.time < 460) {
      event.preventDefault();
      lastNodeClick = { id: null, time: 0 };
      view.nodeDrag = null;
      startInlineNodeEdit(node.id);
      return;
    }
    lastNodeClick = { id: node.id, time: now };
    selectNode(node.id, false);
    const point = clientToWorld(event.clientX, event.clientY);
    view.nodeDrag = {
      id: node.id,
      startX: point.x,
      startY: point.y,
      nodeX: node.x,
      nodeY: node.y,
      before: deepCopy(graphData),
      moved: false
    };
    svg.setPointerCapture(event.pointerId);
  });
  group.addEventListener('click', event => {
    event.stopPropagation();
    if (view.justDragged) {
      view.justDragged = false;
      return;
    }
    if (sidebarMode === 'query' && event.detail > 1) return;
    selectNode(node.id, false);
  });
  group.addEventListener('dblclick', event => {
    if (sidebarMode === 'query') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startInlineNodeEdit(node.id);
  });
  group.addEventListener('keydown', event => {
    if (sidebarMode === 'query' && event.key === 'F2') {
      event.preventDefault();
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      startInlineNodeEdit(node.id);
    } else if (event.key === 'Enter' || event.key === ' ') selectNode(node.id);
  });
  stage.appendChild(group);
}

function renderGraph() {
  svg.replaceChildren();
  svg.dataset.mode = sidebarMode;
  svg.setAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  addDefinitions();
  const stage = createSvgElement('g', {
    id: 'graph-stage',
    transform: `translate(${view.x} ${view.y}) scale(${view.scale})`
  });
  drawWatermarks(stage);
  drawSnapGuides(stage);
  const nodes = nodeMap();
  const relationRoutes = buildRelationRoutes(nodes);
  const occupiedLabels = [];
  const relationPathStage = createSvgElement('g', { class: 'relation-path-layer' });
  const relationLabelStage = createSvgElement('g', { class: 'relation-label-layer' });
  graphData.links.forEach(relation => drawRelation(
    relationPathStage, relationLabelStage, relation, relationRoutes.get(relation.id), occupiedLabels
  ));
  stage.append(relationPathStage, relationLabelStage);
  drawRelationDraft(stage, nodes);
  graphData.nodes.forEach(node => drawNode(stage, node));
  svg.appendChild(stage);
  updateOwnershipQueryHighlight();
  zoomValue.textContent = `${Math.round(view.scale * 100)}%`;
  document.getElementById('canvas-empty').hidden = graphData.nodes.length > 0;
  positionInlineNodeEditor();
  positionInlineRelationEditor();
}

function nodeBadge(node) {
  if (node.root) return '中心';
  if (node.type.includes('自然人')) return '个人';
  if (node.type.includes('股东') || node.type.includes('平台')) return '上游';
  if (node.type.includes('子公司')) return '下游';
  return '主体';
}

function calculateHierarchyLevels() {
  const indegree = new Map(graphData.nodes.map(node => [node.id, 0]));
  const outgoing = new Map(graphData.nodes.map(node => [node.id, []]));
  graphData.links.forEach(link => {
    if (!indegree.has(link.from) || !indegree.has(link.to)) return;
    indegree.set(link.to, indegree.get(link.to) + 1);
    outgoing.get(link.from).push(link.to);
  });

  const levels = new Map();
  const processed = new Set();
  const queue = graphData.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  queue.forEach(id => levels.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    processed.add(id);
    outgoing.get(id).forEach(childId => {
      levels.set(childId, Math.max(levels.get(childId) || 0, (levels.get(id) || 0) + 1));
      indegree.set(childId, indegree.get(childId) - 1);
      if (indegree.get(childId) === 0) queue.push(childId);
    });
  }
  const unresolved = new Set(graphData.nodes.filter(node => !processed.has(node.id)).map(node => node.id));
  return { levels, unresolved };
}

function createNodeListItem(node, treeItem = false) {
  const ownership = getOwnershipSummary(node.id);
  const presentation = getOwnershipPresentation(node, ownership);
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `node-list-item${treeItem ? ' tree-item' : ''}${selected?.kind === 'node' && selected.id === node.id ? ' active' : ''}${ownership.error ? ' ownership-error' : ''}${ownership.warning ? ' ownership-warning' : ''}`;
  item.dataset.nodeId = node.id;
  if (ownership.error || ownership.warning) item.title = presentation.text;
  item.innerHTML = `
    <span class="list-node-icon ${node.root ? 'root' : ''}">${nodeBadge(node).slice(0, 1)}</span>
    <span class="list-node-copy"><strong>${escapeHtml(nodeDisplayLabel(graphData.nodes, node))}</strong><small>${escapeHtml(node.type || '其他主体')}</small></span>
    <span class="list-node-badge">${ownership.error ? '股权错误' : (ownership.warning ? '类型待核' : nodeBadge(node))}</span>
  `;
  item.addEventListener('click', () => selectNode(node.id));
  return item;
}

function chineseLayerNumber(level) {
  const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return numerals[level] || String(level + 1);
}

function layerDescription(level) {
  if (level === 0) return '顶层股东 / 控制主体';
  if (level === 1) return '直接持股主体';
  return '下级持股主体';
}

function renderHierarchyList(visibleNodes) {
  const { levels, unresolved } = calculateHierarchyLevels();
  const groups = new Map();
  visibleNodes.forEach(node => {
    const level = unresolved.has(node.id) ? -1 : (levels.get(node.id) || 0);
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node);
  });
  const orderedLevels = [...groups.keys()].sort((a, b) => {
    if (a === -1) return 1;
    if (b === -1) return -1;
    return a - b;
  });

  orderedLevels.forEach(level => {
    const key = String(level);
    const nodes = groups.get(level);
    const section = document.createElement('section');
    section.className = `node-layer${level === -1 ? ' cycle-layer' : ''}`;
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'layer-heading';
    const expanded = Boolean(searchTerm.trim()) || !collapsedLayers.has(key);
    heading.setAttribute('aria-expanded', String(expanded));
    heading.innerHTML = level === -1
      ? `<span class="layer-index">待定</span><span class="layer-copy">待梳理 · 循环或复杂关系</span><span class="layer-count">${nodes.length} 个</span>`
      : `<span class="layer-index">L${level + 1}</span><span class="layer-copy">第${chineseLayerNumber(level)}层 · ${layerDescription(level)}</span><span class="layer-count">${nodes.length} 个</span>`;
    const items = document.createElement('div');
    items.className = 'layer-items';
    items.hidden = !expanded;
    nodes.forEach(node => items.appendChild(createNodeListItem(node, true)));
    heading.addEventListener('click', () => {
      collapsedLayers.has(key) ? collapsedLayers.delete(key) : collapsedLayers.add(key);
      renderNodeList();
    });
    section.append(heading, items);
    nodeList.appendChild(section);
  });
}

function renderNodeList() {
  const normalized = searchTerm.trim().toLowerCase();
  const visibleNodes = graphData.nodes.filter(node =>
    !normalized || `${node.name} ${node.type} ${node.code}`.toLowerCase().includes(normalized)
  );
  nodeList.replaceChildren();
  if (listViewMode === 'tree') renderHierarchyList(visibleNodes);
  else visibleNodes.forEach(node => nodeList.appendChild(createNodeListItem(node)));
  if (!visibleNodes.length) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = graphData.nodes.length ? '没有匹配的主体' : '尚未创建主体';
    nodeList.appendChild(empty);
  }
  document.getElementById('node-count').textContent = graphData.nodes.length;
  document.getElementById('link-count').textContent = graphData.links.length;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setInspectorMode(mode) {
  inspectorEmpty.hidden = mode !== 'empty';
  nodeEditor.hidden = mode !== 'node';
  linkEditor.hidden = mode !== 'link';
}

function calculateUltimateHoldings(targetId) {
  const nodes = nodeMap();
  const holdings = new Map();
  let hasCycle = false;
  let invalidData = false;

  function walk(currentId, factor, path) {
    const ownership = getOwnershipSummary(currentId);
    if (ownership.error) {
      invalidData = true;
      return;
    }
    const incoming = ownership.incoming.filter(link => parsePercent(link.percent) > 0);
    if (!incoming.length) {
      if (currentId !== targetId) holdings.set(currentId, (holdings.get(currentId) || 0) + factor * 100);
      return;
    }

    incoming.forEach(link => {
      if (path.has(link.from)) {
        hasCycle = true;
        return;
      }
      const nextPath = new Set(path);
      nextPath.add(link.from);
      walk(link.from, factor * parsePercent(link.percent) / 100, nextPath);
    });
  }

  walk(targetId, 1, new Set([targetId]));
  return {
    hasCycle,
    invalidData,
    rows: [...holdings.entries()]
      .map(([id, percent]) => ({ id, name: nodes.get(id)?.name || id, percent }))
      .sort((a, b) => b.percent - a.percent)
  };
}

function renderHoldingRows(container, rows, emptyText) {
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'holding-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  rows.forEach(row => {
    const item = document.createElement('div');
    item.className = 'holding-row';
    const name = document.createElement('span');
    name.textContent = row.name.replace(/\n/g, ' ');
    const percent = document.createElement('strong');
    percent.textContent = formatPercent(row.percent);
    item.append(name, percent);
    container.appendChild(item);
  });
}

function renderOwnershipCalculation(node) {
  const nodes = nodeMap();
  const ownership = getOwnershipSummary(node.id);
  const incoming = ownership.incoming;
  const directRows = incoming.map(link => ({
    id: link.from,
    name: nodes.get(link.from)?.name || link.from,
    percent: parsePercent(link.percent)
  })).sort((a, b) => b.percent - a.percent);
  const total = ownership.total;
  const totalElement = document.getElementById('direct-total');
  const status = document.getElementById('calculation-status');
  const calculator = status.closest('.ownership-calculator');
  const presentation = getOwnershipPresentation(node, ownership);

  totalElement.textContent = formatPercent(total);
  calculator.dataset.state = presentation.state;
  totalElement.dataset.tone = presentation.tone;
  status.dataset.tone = presentation.tone;
  status.textContent = presentation.text;

  renderHoldingRows(document.getElementById('direct-holdings-list'), directRows, '暂无直接股东');
  const ultimate = calculateUltimateHoldings(node.id);
  renderHoldingRows(
    document.getElementById('ultimate-holdings-list'),
    ultimate.invalidData ? [] : ultimate.rows,
    ultimate.invalidData ? '存在股权错误，已暂停穿透计算' : '暂无可穿透的上游股东'
  );
  if (ultimate.hasCycle) {
    const warning = document.createElement('p');
    warning.className = 'holding-cycle-warning';
    warning.textContent = '检测到循环持股，循环部分未计入穿透结果';
    document.getElementById('ultimate-holdings-list').appendChild(warning);
  }
}

function ownershipQueryNodeName(id) {
  return nodeDisplayLabel(graphData.nodes, nodeMap().get(id)) || id;
}

function appendOwnershipQueryEmpty(message, state = 'empty') {
  ownershipQueryResultElement.dataset.state = state;
  const empty = document.createElement('p');
  empty.className = 'ownership-query-empty';
  empty.textContent = message;
  ownershipQueryResultElement.appendChild(empty);
}

function ownershipQueryHasPartialData(result) {
  const ids = new Set(result.paths.flatMap(path => path.nodeIds || []));
  ids.delete(ownershipQuerySourceId);
  return [...ids].some(id => {
    const node = nodeMap().get(id);
    return node && !node.type.includes('自然人') && node.ownershipScope !== 'complete';
  });
}

function renderOwnershipQueryResult(targetNode, result) {
  ownershipQueryResultElement.replaceChildren();
  if (result.invalid && !result.paths.length) {
    const codes = new Set((result.invalidReasons || []).map(reason => reason.code));
    const message = codes.has('SOURCE_NODE_NOT_FOUND') || codes.has('TARGET_NODE_NOT_FOUND')
      ? '权益起点或目标主体已经不存在，请重新选择。'
      : (codes.has('SAME_SOURCE_TARGET')
        ? '权益起点和目标主体不能相同。'
        : '可达路径中存在0%、越界或无法识别的持股比例，请先修复对应关系。');
    appendOwnershipQueryEmpty(message, 'error');
    return;
  }
  if (!result.paths.length) {
    appendOwnershipQueryEmpty(`未发现“${ownershipQueryNodeName(ownershipQuerySourceId)}”到“${ownershipQueryNodeName(ownershipQueryTargetId)}”的持股路径。`);
    return;
  }

  ownershipQueryResultElement.dataset.state = 'ready';
  const total = document.createElement('div');
  total.className = 'ownership-query-total';
  const label = document.createElement('span');
  label.textContent = '已知最终经济权益';
  const value = document.createElement('strong');
  value.textContent = formatPercent(result.totalPercent);
  const description = document.createElement('small');
  description.textContent = `${ownershipQueryNodeName(ownershipQuerySourceId)} → ${targetNode.name.replace(/\n/g, ' ')}`;
  total.append(label, value, description);
  ownershipQueryResultElement.appendChild(total);

  const metrics = document.createElement('div');
  metrics.className = 'ownership-query-metrics';
  [
    ['直接持股', formatPercent(result.directPercent)],
    ['间接权益', formatPercent(result.indirectPercent)],
    ['有效路径', `${result.paths.length} 条`]
  ].forEach(([metricLabel, metricValue]) => {
    const metric = document.createElement('div');
    metric.className = 'ownership-query-metric';
    const span = document.createElement('span');
    span.textContent = metricLabel;
    const strong = document.createElement('strong');
    strong.textContent = metricValue;
    metric.append(span, strong);
    metrics.appendChild(metric);
  });
  ownershipQueryResultElement.appendChild(metrics);

  const notices = [];
  if (result.invalidReasons?.length) {
    notices.push(`已跳过 ${result.invalidReasons.length} 条0%、越界或无法识别的可达关系；结果仅汇总其余有效路径。`);
  }
  if (result.hasCycle) notices.push('检测到循环持股，循环边未计入；当前结果只汇总无环路径。');
  if (ownershipQueryHasPartialData(result)) notices.push('路径中存在“仅录入已知股东”的主体，结果代表当前图谱已录入的已知权益。');
  if (result.totalPercent > 100.005) notices.push('穿透权益超过 100%，请检查重复路径或股权比例。');
  if (notices.length) {
    const notice = document.createElement('p');
    notice.className = 'ownership-query-notice';
    notice.textContent = notices.join(' ');
    ownershipQueryResultElement.appendChild(notice);
  }

  const pathList = document.createElement('div');
  pathList.className = 'ownership-query-paths';
  const pathTitle = document.createElement('p');
  pathTitle.textContent = '持股路径与计算过程';
  pathList.appendChild(pathTitle);
  result.paths.forEach((path, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ownership-query-path${ownershipQueryFocusedPath === index ? ' active' : ''}`;
    const pathLine = document.createElement('span');
    pathLine.className = 'ownership-query-path-line';
    pathLine.textContent = path.nodeIds.map(ownershipQueryNodeName).join(' → ');
    const formula = document.createElement('span');
    formula.className = 'ownership-query-formula';
    const percentages = (path.segments || []).map(segment => formatPercent(segment.percent));
    formula.append(document.createTextNode(`${percentages.join(' × ')} = `));
    const pathValue = document.createElement('b');
    pathValue.textContent = formatPercent(path.pathPercent);
    formula.appendChild(pathValue);
    const badge = document.createElement('span');
    badge.className = 'ownership-query-path-badge';
    const continuousControl = (path.segments || []).length > 0
      && path.segments.every(segment => Number(segment.percent) > 50);
    badge.textContent = path.relationIds.length === 1
      ? '直接持股'
      : (continuousControl ? '连续过半控制链' : `${path.relationIds.length} 层间接持股`);
    button.append(pathLine, formula, badge);
    button.addEventListener('click', () => {
      ownershipQueryFocusedPath = ownershipQueryFocusedPath === index ? null : index;
      renderAll();
    });
    pathList.appendChild(button);
  });
  ownershipQueryResultElement.appendChild(pathList);
}

function renderOwnershipQueryPanel() {
  const nodes = nodeMap();
  if (ownershipQuerySourceId && !nodes.has(ownershipQuerySourceId)) {
    ownershipQuerySourceId = null;
    ownershipQueryTargetId = null;
    ownershipQueryPickRole = 'source';
  }
  if (ownershipQueryTargetId && !nodes.has(ownershipQueryTargetId)) {
    ownershipQueryTargetId = null;
    ownershipQueryPickRole = ownershipQuerySourceId ? 'target' : 'source';
  }
  const sourceButton = document.getElementById('pick-ownership-query-source');
  const targetButton = document.getElementById('pick-ownership-query-target');
  const sourceName = document.getElementById('ownership-query-source-name');
  const targetName = document.getElementById('ownership-query-target-name');
  const prompt = document.getElementById('ownership-query-prompt');
  sourceName.textContent = ownershipQuerySourceId
    ? ownershipQueryNodeName(ownershipQuerySourceId)
    : '点击画布选择';
  targetName.textContent = ownershipQueryTargetId
    ? ownershipQueryNodeName(ownershipQueryTargetId)
    : (ownershipQuerySourceId ? '点击画布选择' : '等待选择 A');
  sourceButton.dataset.active = String(ownershipQueryPickRole === 'source');
  targetButton.dataset.active = String(ownershipQueryPickRole === 'target');
  sourceButton.dataset.filled = String(Boolean(ownershipQuerySourceId));
  targetButton.dataset.filled = String(Boolean(ownershipQueryTargetId));
  prompt.textContent = ownershipQueryPickRole === 'source'
    ? '第 1 步：点击画布中的权益主体'
    : (ownershipQueryPickRole === 'target'
      ? '第 2 步：点击画布中的目标公司'
      : '查询完成 · 点击 A 或 B 可单独重选，直接点第三个主体会开始新查询');
  ownershipQueryResultElement.replaceChildren();
  currentOwnershipQuery = null;

  if (!ownershipQuerySourceId) {
    appendOwnershipQueryEmpty('依次选择 A、B 两个主体后，这里显示实际权益与计算路径。');
    updateOwnershipQueryHighlight();
    return;
  }
  if (!ownershipQueryTargetId) {
    appendOwnershipQueryEmpty('权益起点已选择，请继续点击目标公司。');
    updateOwnershipQueryHighlight();
    return;
  }
  const targetNode = nodeMap().get(ownershipQueryTargetId);
  try {
    currentOwnershipQuery = calculateOwnershipQuery({
      nodes: graphData.nodes,
      links: graphData.links,
      sourceId: ownershipQuerySourceId,
      targetId: ownershipQueryTargetId
    });
    renderOwnershipQueryResult(targetNode, currentOwnershipQuery);
  } catch (error) {
    appendOwnershipQueryEmpty(error.message || '穿透计算失败，请检查持股数据。', 'error');
  }
  updateOwnershipQueryHighlight();
}

function updateOwnershipQueryHighlight() {
  const queryVisible = sidebarMode === 'query';
  const hasPaths = queryVisible && Boolean(currentOwnershipQuery?.paths?.length);
  const highlightedPaths = hasPaths
    ? (ownershipQueryFocusedPath === null
      ? currentOwnershipQuery.paths
      : [currentOwnershipQuery.paths[ownershipQueryFocusedPath]].filter(Boolean))
    : [];
  const nodeIds = new Set(highlightedPaths.flatMap(path => path.nodeIds || []));
  const relationIds = new Set(highlightedPaths.flatMap(path => path.relationIds || []));
  svg.querySelectorAll('.graph-node').forEach(element => {
    const match = nodeIds.has(element.dataset.nodeId);
    element.classList.toggle('query-match', match);
    element.classList.toggle('query-dimmed', hasPaths && !match);
    element.classList.toggle('query-source', queryVisible && element.dataset.nodeId === ownershipQuerySourceId);
    element.classList.toggle('query-target', queryVisible && element.dataset.nodeId === ownershipQueryTargetId);
  });
  svg.querySelectorAll('.graph-relation, .relation-label-group').forEach(element => {
    const match = relationIds.has(element.dataset.relationId);
    element.classList.toggle('query-match', match);
    element.classList.toggle('query-dimmed', hasPaths && !match);
  });
}

function localDateString() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function getFinancingEligibility(node) {
  const ownership = getOwnershipSummary(node.id);
  if (node.type.includes('自然人')) {
    return { allowed: false, ownership, message: '自然人不是发行股权的公司主体，不能执行增资融资。' };
  }
  if (ownership.error || !ownership.complete) {
    return { allowed: false, ownership, message: '融资前已录入的直接持股必须无错误且合计为 100%。请先补齐或修复持股比例。' };
  }
  return { allowed: true, ownership, message: '当前直接持股合计 100%，可以模拟纯增资和等比例稀释。' };
}

function populateFinancingInvestors(node) {
  const select = document.getElementById('finance-investor');
  const sameCompany = select.dataset.companyId === node.id;
  const previous = sameCompany ? select.value : '__new__';
  select.replaceChildren();
  const newOption = document.createElement('option');
  newOption.value = '__new__';
  newOption.textContent = '＋ 创建新投资人';
  select.appendChild(newOption);
  graphData.nodes.filter(candidate => candidate.id !== node.id).forEach(candidate => {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = nodeDisplayLabel(graphData.nodes, candidate);
    select.appendChild(option);
  });
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  else select.value = '__new__';
  select.dataset.companyId = node.id;
  document.getElementById('finance-new-investor-field').hidden = select.value !== '__new__';
}

function resetFinancingDraft() {
  const investorSelect = document.getElementById('finance-investor');
  investorSelect.value = '__new__';
  delete investorSelect.dataset.companyId;
  document.getElementById('finance-mode').value = 'percent';
  document.getElementById('finance-post-percent').value = '20';
  document.getElementById('finance-pre-money').value = '';
  document.getElementById('finance-investment').value = '';
  document.getElementById('finance-currency').value = 'CNY';
  document.getElementById('finance-round').value = '';
  document.getElementById('finance-date').value = localDateString();
  document.getElementById('finance-new-investor-name').value = '';
  document.getElementById('finance-new-investor-field').hidden = false;
  syncFinancingMode();
}

function renderFinancingHistory(node) {
  const container = document.getElementById('financing-history');
  const events = graphData.financingEvents
    .filter(event => event.companyId === node.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 5);
  container.replaceChildren();
  if (!events.length) return;
  const title = document.createElement('p');
  title.className = 'financing-history-title';
  title.textContent = '最近融资记录';
  container.appendChild(title);
  events.forEach(event => {
    const item = document.createElement('div');
    item.className = 'financing-event';
    const name = document.createElement('strong');
    name.textContent = `${event.round} · ${event.investorName}`;
    const date = document.createElement('time');
    date.textContent = event.date || '未填日期';
    const result = document.createElement('span');
    const currency = event.currency ? ` · ${event.currency}` : '';
    result.textContent = `模拟 · 投资人投后持股 ${formatPercent(event.postMoneyPercent)} · 本轮新增份额 ${formatPercent(event.newIssuePercent)}${currency}`;
    item.append(name, date, result);
    container.appendChild(item);
  });
}

function renderFinancingPanel(node) {
  const open = financingOpenNodeId === node.id;
  const toggle = document.getElementById('toggle-financing');
  const eligibility = getFinancingEligibility(node);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? '收起' : '新建融资';
  financingWorkspace.hidden = !open;
  financingGate.dataset.tone = eligibility.allowed ? 'ok' : 'danger';
  financingGate.textContent = eligibility.message;
  document.getElementById('apply-financing').disabled = true;
  populateFinancingInvestors(node);
  renderFinancingHistory(node);
  if (open) renderFinancingPreview(node);
}

function syncFinancingMode() {
  const valuationMode = document.getElementById('finance-mode').value === 'valuation';
  document.getElementById('finance-percent-fields').hidden = valuationMode;
  document.getElementById('finance-valuation-fields').hidden = !valuationMode;
}

function wouldCreateOwnershipCycle(fromId, toId) {
  if (graphData.links.some(link => link.from === fromId && link.to === toId)) return false;
  const outgoing = new Map(graphData.nodes.map(node => [node.id, []]));
  graphData.links.forEach(link => outgoing.get(link.from)?.push(link.to));
  const queue = [toId];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(outgoing.get(current) || []));
  }
  return false;
}

function createFinancingPlan(node, requireInvestorName = false) {
  const eligibility = getFinancingEligibility(node);
  if (!eligibility.allowed) throw new Error(eligibility.message);
  const mode = document.getElementById('finance-mode').value;
  const investorSelection = document.getElementById('finance-investor').value;
  const isNewInvestor = investorSelection === '__new__';
  const investorName = isNewInvestor
    ? document.getElementById('finance-new-investor-name').value.trim()
    : nodeMap().get(investorSelection)?.name.replace(/\n/g, ' ');
  if (requireInvestorName && !investorName) throw new Error('请填写新投资人名称');
  if (!isNewInvestor && wouldCreateOwnershipCycle(investorSelection, node.id)) {
    throw new Error('该投资人位于目标公司的下游，融资后会形成循环持股，请选择其他投资人');
  }

  const preMoneyValuation = Number(document.getElementById('finance-pre-money').value);
  const investmentAmount = Number(document.getElementById('finance-investment').value);
  const currency = document.getElementById('finance-currency').value;
  if (mode === 'valuation' && (!Number.isFinite(preMoneyValuation) || preMoneyValuation <= 0
    || !Number.isFinite(investmentAmount) || investmentAmount <= 0)) {
    throw new Error('投前估值和投资额必须填写大于 0 的数字，并使用相同货币单位');
  }
  const directPostMoneyPercent = Number(document.getElementById('finance-post-percent').value);
  if (mode === 'percent' && (!Number.isFinite(directPostMoneyPercent)
    || directPostMoneyPercent <= 0 || directPostMoneyPercent >= 100)) {
    throw new Error('投资人目标投后持股必须大于 0% 且小于 100%');
  }
  const investors = nodeMap();
  const shareholders = eligibility.ownership.incoming.map(link => ({
    id: link.from,
    name: investors.get(link.from)?.name.replace(/\n/g, ' ') || link.from,
    percent: parsePercent(link.percent)
  }));
  const temporaryInvestorId = isNewInvestor ? '__new-financing-investor__' : investorSelection;
  const plan = mode === 'valuation'
    ? calculateDilutionPlanFromNewIssuePercent({
      shareholders,
      investorId: temporaryInvestorId,
      newIssuePercent: calculateNewIssuePercentFromValuation({ preMoneyValuation, investmentAmount })
    })
    : calculateDilutionPlan({
      shareholders,
      investorId: temporaryInvestorId,
      postMoneyPercent: directPostMoneyPercent
    });
  return {
    ...plan,
    companyId: node.id,
    mode,
    investorId: temporaryInvestorId,
    investorSelection,
    investorName: investorName || '新投资人',
    isNewInvestor,
    postMoneyPercent: plan.postMoneyPercent,
    newIssuePercent: plan.newIssuePercent,
    currency: mode === 'valuation' ? currency : null,
    preMoneyValuation: mode === 'valuation' ? preMoneyValuation : null,
    investmentAmount: mode === 'valuation' ? investmentAmount : null,
    shareholders
  };
}

function financingErrorMessage(error) {
  const message = String(error?.message || error);
  if (message.includes('must exceed the existing investor percentage')) {
    return '现有股东参与增资后，其投后持股必须高于当前持股比例';
  }
  if (message.includes('must total 100')) return '融资前完整股东名册必须合计为 100%';
  if (message.includes('postMoneyPercent')) return '投资人目标投后持股必须大于 0% 且小于 100%';
  if (message.includes('newIssuePercent')) return '本轮新增份额必须大于 0% 且小于 100%';
  if (message.includes('duplicate shareholder')) return '融资前存在重复股东，请先合并重复持股关系';
  return message;
}

function appendFinancingPreviewRow(name, before, after, isNewInvestor = false) {
  const row = document.createElement('div');
  row.className = `financing-preview-row${isNewInvestor ? ' new-investor' : ''}`;
  const label = document.createElement('span');
  label.textContent = name;
  const beforeValue = document.createElement('span');
  beforeValue.className = 'before';
  beforeValue.textContent = formatPercent(before);
  const arrow = document.createElement('i');
  arrow.textContent = '→';
  const afterValue = document.createElement('span');
  afterValue.className = 'after';
  afterValue.textContent = formatPercent(after);
  row.append(label, beforeValue, arrow, afterValue);
  financingPreviewTable.appendChild(row);
}

function renderFinancingPreview(node = selected?.kind === 'node' ? nodeMap().get(selected.id) : null) {
  financingPreviewTable.replaceChildren();
  currentFinancingPlan = null;
  const applyButton = document.getElementById('apply-financing');
  applyButton.disabled = true;
  if (!node) return;
  try {
    const plan = createFinancingPlan(node, true);
    const beforeById = new Map(plan.shareholders.map(row => [row.id, row]));
    const names = nodeMap();
    plan.after.forEach(row => {
      const before = beforeById.get(row.id)?.percent || 0;
      const name = row.id === plan.investorId
        ? plan.investorName
        : (beforeById.get(row.id)?.name || names.get(row.id)?.name.replace(/\n/g, ' ') || row.id);
      appendFinancingPreviewRow(name, before, row.percent, !beforeById.has(row.id));
    });
    document.getElementById('finance-result-percent').textContent = formatPercent(plan.postMoneyPercent);
    const investorWasShareholder = plan.shareholders.some(row => row.id === plan.investorId);
    document.getElementById('financing-preview-note').textContent = investorWasShareholder
      ? `本轮新增份额 ${formatPercent(plan.newIssuePercent)}；其他原股东统一乘以 ${formatPercent(plan.dilutionFactor * 100)}，投资人投后达到 ${formatPercent(plan.postMoneyPercent)}。`
      : `本轮新增份额 ${formatPercent(plan.newIssuePercent)}；全部原股东统一乘以 ${formatPercent(plan.dilutionFactor * 100)}。纯老股转让不适用此计算。`;
    financingPreview.dataset.state = 'ready';
    currentFinancingPlan = plan;
    applyButton.disabled = false;
  } catch (error) {
    document.getElementById('finance-result-percent').textContent = '—';
    document.getElementById('financing-preview-note').textContent = financingErrorMessage(error);
    financingPreview.dataset.state = 'error';
  }
}

function applyFinancing() {
  if (selected?.kind !== 'node') return;
  const company = nodeMap().get(selected.id);
  if (!company) return;
  let plan;
  try {
    plan = createFinancingPlan(company, true);
  } catch (error) {
    showToast(financingErrorMessage(error), 'warning');
    renderFinancingPreview(company);
    return;
  }

  const actualInvestorId = plan.isNewInvestor ? generateId('node') : plan.investorSelection;
  const actualAfter = plan.after.map(row => ({
    ...row,
    id: row.id === plan.investorId ? actualInvestorId : row.id
  }));
  const round = document.getElementById('finance-round').value.trim() || '新一轮融资';
  const date = document.getElementById('finance-date').value || localDateString();
  const beforeSnapshot = plan.shareholders.map(row => ({ id: row.id, name: row.name, percent: row.percent }));
  const afterNames = new Map(beforeSnapshot.map(row => [row.id, row.name]));
  afterNames.set(actualInvestorId, plan.investorName);

  financingOpenNodeId = null;
  commit(`${round}融资测算已应用，原股东已等比例稀释`, () => {
    if (plan.isNewInvestor) {
      const relatedCount = graphData.links.filter(link => link.to === company.id).length;
      graphData.nodes.push({
        id: actualInvestorId,
        name: plan.investorName,
        type: '企业股东',
        code: '', note: `${round}新增投资人`, ownershipScope: 'partial', root: false, ribbon: null,
        x: Math.max(20, company.x + (relatedCount % 2 === 0 ? 1 : -1) * Math.ceil((relatedCount + 1) / 2) * 245),
        y: Math.max(20, company.y - 205)
      });
    }

    const afterById = new Map(actualAfter.map(row => [row.id, row.percent]));
    graphData.links.filter(link => link.to === company.id).forEach(link => {
      if (afterById.has(link.from)) link.percent = formatPercent(afterById.get(link.from));
    });
    const existingInvestorRelation = graphData.links.find(link => link.from === actualInvestorId && link.to === company.id);
    if (!existingInvestorRelation) {
      graphData.links.push({
        id: generateId('relation'), from: actualInvestorId, to: company.id,
        percent: formatPercent(afterById.get(actualInvestorId))
      });
    }
    graphData.financingEvents.push({
      id: generateId('financing'), companyId: company.id, investorId: actualInvestorId,
      investorName: plan.investorName, round, date, mode: plan.mode,
      status: 'simulated', currency: plan.currency,
      postMoneyPercent: plan.postMoneyPercent,
      newIssuePercent: plan.newIssuePercent,
      preMoneyValuation: plan.preMoneyValuation,
      investmentAmount: plan.investmentAmount,
      before: beforeSnapshot,
      after: actualAfter.map(row => ({ id: row.id, name: afterNames.get(row.id) || row.id, percent: row.percent })),
      createdAt: new Date().toISOString()
    });
  });
}

function renderInspector() {
  if (!selected) {
    setInspectorMode('empty');
    return;
  }
  if (selected.kind === 'node') {
    const node = nodeMap().get(selected.id);
    if (!node) return setInspectorMode('empty');
    setInspectorMode('node');
    document.getElementById('node-editor-title').textContent = node.name.replace(/\n/g, ' ');
    document.getElementById('node-id-chip').textContent = node.id.slice(0, 14);
    document.getElementById('edit-name').value = node.name;
    document.getElementById('edit-type').value = [...document.getElementById('edit-type').options].some(option => option.value === node.type)
      ? node.type : '其他主体';
    document.getElementById('edit-code').value = node.code;
    const ownershipScopeSelect = document.getElementById('edit-ownership-scope');
    ownershipScopeSelect.value = node.type.includes('自然人') ? 'partial' : node.ownershipScope;
    ownershipScopeSelect.disabled = node.type.includes('自然人');
    document.getElementById('edit-note').value = node.note;
    document.getElementById('edit-root').checked = node.root;
    document.getElementById('edit-ribbon').value = node.ribbon?.tone || '';
    renderOwnershipCalculation(node);
    renderFinancingPanel(node);
    return;
  }
  const relation = relationMap().get(selected.id);
  if (!relation) return setInspectorMode('empty');
  setInspectorMode('link');
  populateNodeSelect(document.getElementById('edit-from'), relation.from);
  populateNodeSelect(document.getElementById('edit-to'), relation.to);
  document.getElementById('edit-percent').value = parsePercent(relation.percent);
}

function populateNodeSelect(select, currentValue) {
  select.replaceChildren();
  graphData.nodes.forEach(node => {
    const option = document.createElement('option');
    option.value = node.id;
    option.textContent = nodeDisplayLabel(graphData.nodes, node);
    option.selected = node.id === currentValue;
    select.appendChild(option);
  });
}

function renderAll() {
  renderOwnershipQueryPanel();
  renderGraph();
  renderNodeList();
  renderInspector();
}

function handleOwnershipQueryNodePick(id) {
  if (ownershipQueryPickRole === 'target') {
    if (id === ownershipQuerySourceId) {
      showToast('权益起点和目标公司不能是同一个主体', 'warning');
      return;
    }
    ownershipQueryTargetId = id;
    ownershipQueryPickRole = null;
  } else {
    ownershipQuerySourceId = id;
    ownershipQueryTargetId = null;
    ownershipQueryPickRole = 'target';
  }
  currentOwnershipQuery = null;
  ownershipQueryFocusedPath = null;
  renderAll();
  if (ownershipQueryPickRole === 'target') showToast('已选择权益起点，请点击目标公司');
}

function selectNode(id, fullRender = true) {
  if (sidebarMode === 'query') {
    handleOwnershipQueryNodePick(id);
    return;
  }
  selected = { kind: 'node', id };
  if (fullRender) renderAll();
  else {
    svg.querySelectorAll('.graph-node').forEach(element => {
      element.classList.toggle('selected', element.dataset.nodeId === id);
    });
    svg.querySelectorAll('.graph-relation, .relation-label-group').forEach(element => element.classList.remove('selected'));
    svg.querySelectorAll('.graph-relation, .relation-label-group').forEach(element => {
      element.classList.toggle('from-selected', element.dataset.fromId === id);
    });
    renderNodeList();
    renderInspector();
  }
}

function selectRelation(id) {
  if (sidebarMode === 'query') {
    showToast('请点击主体框选择查询起点或目标公司', 'warning');
    return;
  }
  selected = { kind: 'link', id };
  renderAll();
}

function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function addStandaloneNode() {
  if (!canEditGraph()) return;
  const id = generateId('node');
  const name = suggestUniqueNodeName(graphData.nodes, '新主体');
  commit('已新增独立主体', () => {
    graphData.nodes.push({
      id, name, type: '其他主体', code: '', note: '', root: graphData.nodes.length === 0,
      ownershipScope: 'partial', ribbon: null, x: 650, y: 390
    });
  });
  selectNode(id);
  document.getElementById('edit-name').focus();
  document.getElementById('edit-name').select();
}

function addConnectedNode(direction) {
  if (!canEditGraph()) return;
  if (selected?.kind !== 'node') {
    showToast('请先选择一个主体', 'warning');
    return;
  }
  const target = nodeMap().get(selected.id);
  if (direction === 'upstream' && target.type.includes('自然人')) {
    showToast('自然人不能作为被投主体，无法为其新增上游股东', 'warning');
    return;
  }
  const id = generateId('node');
  const upstream = direction === 'upstream';
  const related = graphData.links.filter(link => upstream ? link.to === target.id : link.from === target.id);
  const offset = (related.length % 2 === 0 ? 1 : -1) * Math.ceil((related.length + 1) / 2) * 245;
  const newNode = {
    id,
    name: suggestUniqueNodeName(graphData.nodes, upstream ? '新股东' : '新子公司'),
    type: upstream ? '企业股东' : '控股子公司',
    code: '', note: '', ownershipScope: 'partial', root: false, ribbon: null,
    x: Math.max(20, target.x + offset),
    y: Math.max(20, target.y + (upstream ? -205 : 220))
  };
  commit(upstream ? '已新增上游股东' : '已新增下游子公司', () => {
    graphData.nodes.push(newNode);
    graphData.links.push({
      id: generateId('relation'),
      from: upstream ? id : target.id,
      to: upstream ? target.id : id,
      percent: upstream ? '0%' : '100%'
    });
  });
  selectNode(id);
  document.getElementById('edit-name').focus();
  document.getElementById('edit-name').select();
}

function deleteSelectedNode() {
  if (!canEditGraph()) return;
  if (selected?.kind !== 'node') return;
  const node = nodeMap().get(selected.id);
  if (!node || !confirm(`确定删除“${node.name.replace(/\n/g, ' ')}”及其所有相关关系吗？`)) return;
  const id = node.id;
  if (ownershipQuerySourceId === id) {
    ownershipQuerySourceId = null;
    ownershipQueryTargetId = null;
    ownershipQueryPickRole = 'source';
    currentOwnershipQuery = null;
    ownershipQueryFocusedPath = null;
  } else if (ownershipQueryTargetId === id) {
    ownershipQueryTargetId = null;
    ownershipQueryPickRole = 'target';
    currentOwnershipQuery = null;
    ownershipQueryFocusedPath = null;
  }
  commit('主体已删除', () => {
    graphData.nodes = graphData.nodes.filter(item => item.id !== id);
    graphData.links = graphData.links.filter(link => link.from !== id && link.to !== id);
    selected = null;
  });
}

function autoLayout() {
  if (!graphData.nodes.length) return;
  commit('已自动整理图谱布局', () => {
    const incoming = new Map(graphData.nodes.map(node => [node.id, []]));
    graphData.links.forEach(link => incoming.get(link.to)?.push(link.from));
    const levels = new Map();
    graphData.nodes.filter(node => incoming.get(node.id)?.length === 0).forEach(node => levels.set(node.id, 0));
    if (!levels.size && graphData.nodes[0]) levels.set(graphData.nodes[0].id, 0);
    for (let pass = 0; pass < graphData.nodes.length; pass += 1) {
      graphData.links.forEach(link => {
        if (!levels.has(link.from)) return;
        levels.set(link.to, Math.max(levels.get(link.to) ?? 0, levels.get(link.from) + 1));
      });
    }
    graphData.nodes.forEach(node => {
      if (!levels.has(node.id)) levels.set(node.id, 0);
    });
    const groups = new Map();
    graphData.nodes.forEach(node => {
      const level = levels.get(node.id);
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    });
    [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([level, nodes]) => {
      const gap = Math.min(285, 1450 / Math.max(1, nodes.length));
      const total = (nodes.length - 1) * gap;
      const start = 760 - total / 2;
      nodes.forEach((node, index) => {
        node.x = Math.max(20, start + index * gap - nodeDimensions(node).width / 2);
        node.y = 65 + level * 205;
      });
    });
  }, { includeView: true });
  fitView();
}

function clientToSvg(clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function clientToWorld(clientX, clientY) {
  const svgPoint = clientToSvg(clientX, clientY);
  return {
    x: (svgPoint.x - view.x) / view.scale,
    y: (svgPoint.y - view.y) / view.scale
  };
}

function setScale(next, centerX = VIEW_WIDTH / 2, centerY = VIEW_HEIGHT / 2) {
  const previous = view.scale;
  view.scale = Math.min(1.7, Math.max(.34, next));
  const ratio = view.scale / previous;
  view.x = centerX - (centerX - view.x) * ratio;
  view.y = centerY - (centerY - view.y) * ratio;
  renderGraph();
}

function fitView() {
  if (!graphData.nodes.length) {
    view.scale = .82;
    view.x = 110;
    view.y = 60;
    renderGraph();
    return;
  }
  const boxes = graphData.nodes.map(node => {
    const size = nodeDimensions(node);
    return { left: node.x, right: node.x + size.width, top: node.y, bottom: node.y + size.height };
  });
  const left = Math.min(...boxes.map(box => box.left));
  const right = Math.max(...boxes.map(box => box.right));
  const top = Math.min(...boxes.map(box => box.top));
  const bottom = Math.max(...boxes.map(box => box.bottom));
  const width = Math.max(300, right - left + 180);
  const height = Math.max(260, bottom - top + 180);
  view.scale = Math.min(1.18, Math.max(.38, Math.min(VIEW_WIDTH / width, VIEW_HEIGHT / height)));
  view.x = VIEW_WIDTH / 2 - ((left + right) / 2) * view.scale;
  view.y = VIEW_HEIGHT / 2 - ((top + bottom) / 2) * view.scale;
  renderGraph();
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setWatermarkEditorOpen(open) {
  watermarkEditor.hidden = !open;
  editWatermarkButton.setAttribute('aria-expanded', String(open));
}

function openWatermarkEditor() {
  if (!canEditGraph()) {
    showToast('权益查询模式不修改文档水印，请先切回主体清单', 'warning');
    return;
  }
  const current = graphData.settings.watermarkText;
  watermarkDraftText = current;
  watermarkTextInput.value = current;
  setWatermarkEditorOpen(true);
  renderGraph();
  requestAnimationFrame(() => {
    watermarkTextInput.focus();
    watermarkTextInput.select();
  });
}

function cancelWatermarkEditor() {
  watermarkDraftText = null;
  setWatermarkEditorOpen(false);
  renderGraph();
}

function saveWatermarkEditor() {
  const rawText = watermarkTextInput.value.replace(/\s+/g, ' ').trim();
  if (!rawText) {
    showToast('水印内容不能为空；如不需要水印可点击“隐藏水印”', 'warning');
    watermarkTextInput.focus();
    return false;
  }
  const nextText = normalizeWatermarkText(rawText);
  const currentText = graphData.settings.watermarkText;
  watermarkDraftText = null;
  setWatermarkEditorOpen(false);
  if (nextText === currentText) {
    renderGraph();
    return true;
  }
  commit('水印内容已更新', () => {
    graphData.settings.watermarkText = nextText;
  });
  return true;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(graphData, null, 2)], { type: 'application/json' });
  downloadBlob(`企业股权结构图-${new Date().toISOString().slice(0, 10)}.json`, blob);
  showToast('JSON 数据已导出');
}

function exportImage() {
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', String(VIEW_WIDTH));
  clone.setAttribute('height', String(VIEW_HEIGHT));
  clone.setAttribute('xmlns', SVG_NS);
  const serialized = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = VIEW_WIDTH * 2;
    canvas.height = VIEW_HEIGHT * 2;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) downloadBlob(`企业股权结构图-${new Date().toISOString().slice(0, 10)}.png`, blob);
      showToast('图谱图片已导出');
    }, 'image/png');
  };
  image.onerror = () => showToast('图片导出失败，请重试', 'warning');
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}

document.getElementById('node-search').addEventListener('input', event => {
  searchTerm = event.target.value;
  renderNodeList();
});

inlineNodeEditor.addEventListener('submit', event => {
  event.preventDefault();
  saveInlineNodeEdit();
});

inlineNodeName.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.stopPropagation();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelInlineNodeEdit();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    saveInlineNodeEdit();
  }
});

inlineNodeName.addEventListener('blur', () => {
  setTimeout(() => {
    if (!inlineEditingNodeId) return;
    if (performance.now() < inlineBlurGuardUntil) {
      inlineNodeName.focus();
      return;
    }
    saveInlineNodeEdit();
  }, 0);
});

inlineRelationEditor.addEventListener('submit', event => {
  event.preventDefault();
  saveInlineRelationEdit();
});

inlineRelationPercent.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.stopPropagation();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelInlineRelationEdit();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    saveInlineRelationEdit();
  }
});

inlineRelationPercent.addEventListener('blur', () => {
  setTimeout(() => {
    if (!inlineEditingRelationId) return;
    if (performance.now() < inlineRelationBlurGuardUntil) {
      inlineRelationPercent.focus();
      return;
    }
    saveInlineRelationEdit();
  }, 0);
});

function setListViewMode(mode) {
  listViewMode = mode;
  const treeButton = document.getElementById('tree-view');
  const flatButton = document.getElementById('flat-view');
  treeButton.classList.toggle('active', mode === 'tree');
  flatButton.classList.toggle('active', mode === 'flat');
  treeButton.setAttribute('aria-pressed', String(mode === 'tree'));
  flatButton.setAttribute('aria-pressed', String(mode === 'flat'));
  renderNodeList();
}

function flushInlineEdits() {
  if (inlineEditingNodeId) {
    saveInlineNodeEdit();
    if (inlineEditingNodeId) return false;
  }
  if (inlineEditingRelationId) {
    saveInlineRelationEdit();
    if (inlineEditingRelationId) return false;
  }
  if (!watermarkEditor.hidden && !saveWatermarkEditor()) return false;
  return true;
}

function setSidebarMode(mode) {
  const nextMode = mode === 'query' ? 'query' : 'subjects';
  if (nextMode !== sidebarMode && !flushInlineEdits()) return;
  sidebarMode = nextMode;
  const queryMode = sidebarMode === 'query';
  if (queryMode) {
    selected = null;
    financingOpenNodeId = null;
    currentFinancingPlan = null;
  }
  document.getElementById('subject-sidebar-view').hidden = queryMode;
  document.getElementById('query-sidebar-view').hidden = !queryMode;
  document.getElementById('add-independent').hidden = queryMode;
  document.getElementById('sidebar-mode-title').textContent = queryMode ? '权益查询' : '主体清单';
  document.getElementById('canvas-hint').textContent = queryMode
    ? '权益查询：依次点击两个主体 · 再点第三个主体开始新查询'
    : '拖动节点底部圆点建立关系 · 双击节点改名 · 点击比例修改';
  document.getElementById('sidebar-subjects').setAttribute('aria-selected', String(!queryMode));
  document.getElementById('sidebar-ownership-query').setAttribute('aria-selected', String(queryMode));
  if (queryMode && !ownershipQuerySourceId && !ownershipQueryTargetId) ownershipQueryPickRole = 'source';
  renderAll();
}

document.getElementById('tree-view').addEventListener('click', () => setListViewMode('tree'));
document.getElementById('flat-view').addEventListener('click', () => setListViewMode('flat'));
document.getElementById('sidebar-subjects').addEventListener('click', () => setSidebarMode('subjects'));
document.getElementById('sidebar-ownership-query').addEventListener('click', () => setSidebarMode('query'));
document.getElementById('pick-ownership-query-source').addEventListener('click', () => {
  ownershipQueryPickRole = 'source';
  ownershipQueryFocusedPath = null;
  renderAll();
});
document.getElementById('pick-ownership-query-target').addEventListener('click', () => {
  if (!ownershipQuerySourceId) {
    ownershipQueryPickRole = 'source';
    showToast('请先选择权益起点', 'warning');
  } else {
    ownershipQueryPickRole = 'target';
  }
  ownershipQueryFocusedPath = null;
  renderAll();
});
document.getElementById('clear-ownership-query').addEventListener('click', () => {
  ownershipQuerySourceId = null;
  ownershipQueryTargetId = null;
  ownershipQueryPickRole = 'source';
  ownershipQueryFocusedPath = null;
  currentOwnershipQuery = null;
  renderAll();
});
document.getElementById('toggle-financing').addEventListener('click', () => {
  if (selected?.kind !== 'node') return;
  const opening = financingOpenNodeId !== selected.id;
  financingOpenNodeId = opening ? selected.id : null;
  currentFinancingPlan = null;
  if (opening) resetFinancingDraft();
  renderInspector();
});
document.getElementById('finance-mode').addEventListener('change', () => {
  syncFinancingMode();
  renderFinancingPreview();
});
document.getElementById('finance-investor').addEventListener('change', event => {
  document.getElementById('finance-new-investor-field').hidden = event.target.value !== '__new__';
  renderFinancingPreview();
});
document.getElementById('finance-currency').addEventListener('change', () => renderFinancingPreview());
[
  'finance-new-investor-name', 'finance-post-percent', 'finance-pre-money',
  'finance-investment', 'finance-round', 'finance-date'
].forEach(id => document.getElementById(id).addEventListener('input', () => renderFinancingPreview()));
financingWorkspace.addEventListener('keydown', event => {
  if (event.key === 'Enter') event.preventDefault();
});
document.getElementById('apply-financing').addEventListener('click', applyFinancing);
document.getElementById('edit-type').addEventListener('change', event => {
  const ownershipScopeSelect = document.getElementById('edit-ownership-scope');
  ownershipScopeSelect.disabled = event.target.value.includes('自然人');
  if (ownershipScopeSelect.disabled) ownershipScopeSelect.value = 'partial';
});

nodeEditor.addEventListener('submit', event => {
  event.preventDefault();
  if (sidebarMode === 'query') return;
  if (selected?.kind !== 'node') return;
  const id = selected.id;
  const name = document.getElementById('edit-name').value.trim();
  if (!name) return showToast('主体名称不能为空', 'warning');
  commit('主体信息已保存', () => {
    const node = nodeMap().get(id);
    node.name = name;
    node.type = document.getElementById('edit-type').value;
    node.code = document.getElementById('edit-code').value.trim();
    node.ownershipScope = node.type.includes('自然人') ? 'partial' : document.getElementById('edit-ownership-scope').value;
    node.note = document.getElementById('edit-note').value.trim();
    node.root = document.getElementById('edit-root').checked;
    const ribbon = document.getElementById('edit-ribbon').value;
    node.ribbon = ribbon ? { tone: ribbon, text: ribbon === 'risk' ? 'Risk' : 'Controller' } : null;
  });
});

linkEditor.addEventListener('submit', event => {
  event.preventDefault();
  if (sidebarMode === 'query') return;
  if (selected?.kind !== 'link') return;
  const id = selected.id;
  const from = document.getElementById('edit-from').value;
  const to = document.getElementById('edit-to').value;
  const percent = Number(document.getElementById('edit-percent').value);
  if (from === to) return showToast('股东和被投企业不能是同一主体', 'warning');
  if (nodeMap().get(to)?.type.includes('自然人')) return showToast('自然人不能作为股权关系的被投主体', 'warning');
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return showToast('持股比例必须是 0 到 100 之间的数字', 'warning');
  }
  const duplicate = graphData.links.some(link => link.id !== id && link.from === from && link.to === to);
  if (duplicate) return showToast('这条持股关系已经存在', 'warning');
  commit('持股关系已保存', () => {
    const relation = relationMap().get(id);
    relation.from = from;
    relation.to = to;
    relation.percent = formatPercent(percent);
  });
});

document.getElementById('delete-node').addEventListener('click', deleteSelectedNode);
document.getElementById('delete-link').addEventListener('click', () => {
  if (!canEditGraph()) return;
  if (selected?.kind !== 'link') return;
  if (!confirm('确定删除这条持股关系吗？')) return;
  const id = selected.id;
  commit('持股关系已删除', () => {
    graphData.links = graphData.links.filter(link => link.id !== id);
    selected = null;
  });
});
document.getElementById('add-shareholder').addEventListener('click', () => addConnectedNode('upstream'));
document.getElementById('add-subsidiary').addEventListener('click', () => addConnectedNode('downstream'));
document.getElementById('add-independent').addEventListener('click', addStandaloneNode);
document.getElementById('empty-add').addEventListener('click', addStandaloneNode);
document.getElementById('undo').addEventListener('click', undo);
document.getElementById('redo').addEventListener('click', redo);
document.getElementById('auto-layout').addEventListener('click', autoLayout);
document.getElementById('toggle-snap').addEventListener('click', event => {
  view.snapEnabled = !view.snapEnabled;
  view.snapGuides = null;
  event.currentTarget.classList.toggle('active', view.snapEnabled);
  event.currentTarget.setAttribute('aria-pressed', String(view.snapEnabled));
  event.currentTarget.textContent = view.snapEnabled ? '磁吸：开' : '磁吸：关';
  renderGraph();
  showToast(view.snapEnabled ? '对齐参考线与自动吸附已开启' : '自动吸附已关闭');
});
document.getElementById('export-json').addEventListener('click', exportJson);
document.getElementById('export-image').addEventListener('click', exportImage);
document.getElementById('zoom-in').addEventListener('click', () => setScale(zoomInScale(view.scale)));
document.getElementById('zoom-out').addEventListener('click', () => setScale(zoomOutScale(view.scale)));
document.getElementById('fit-view').addEventListener('click', fitView);
document.getElementById('toggle-watermark').addEventListener('click', event => {
  view.showWatermark = !view.showWatermark;
  event.currentTarget.textContent = view.showWatermark ? '隐藏水印' : '显示水印';
  renderGraph();
});
editWatermarkButton.addEventListener('click', () => {
  if (watermarkEditor.hidden) openWatermarkEditor();
  else saveWatermarkEditor();
});
watermarkTextInput.addEventListener('input', () => {
  watermarkDraftText = watermarkTextInput.value.slice(0, 60);
  renderGraph();
});
watermarkEditor.addEventListener('submit', event => {
  event.preventDefault();
  saveWatermarkEditor();
});
watermarkEditor.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  cancelWatermarkEditor();
});
watermarkEditor.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!watermarkEditor.hidden && !watermarkEditor.contains(document.activeElement)) saveWatermarkEditor();
  }, 0);
});
document.getElementById('reset-watermark').addEventListener('click', () => {
  watermarkTextInput.value = DEFAULT_WATERMARK_TEXT;
  watermarkDraftText = DEFAULT_WATERMARK_TEXT;
  saveWatermarkEditor();
});

document.getElementById('new-document').addEventListener('click', () => {
  if (!confirm('确定新建空白图谱吗？当前数据仍可通过撤销恢复。')) return;
  if (!watermarkEditor.hidden) cancelWatermarkEditor();
  commit('已新建空白图谱', () => {
    graphData = {
      nodes: [], links: [], financingEvents: [],
      settings: { watermarkText: DEFAULT_WATERMARK_TEXT }
    };
    selected = null;
    ownershipQuerySourceId = null;
    ownershipQueryTargetId = null;
    ownershipQueryPickRole = 'source';
    currentOwnershipQuery = null;
    ownershipQueryFocusedPath = null;
  });
});

const importFile = document.getElementById('import-file');
document.getElementById('import-json').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async event => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const imported = normalizeData(JSON.parse(await file.text()));
    if (!watermarkEditor.hidden) cancelWatermarkEditor();
    commit('JSON 数据已导入', () => {
      graphData = imported;
      selected = null;
      ownershipQuerySourceId = null;
      ownershipQueryTargetId = null;
      ownershipQueryPickRole = 'source';
      currentOwnershipQuery = null;
      ownershipQueryFocusedPath = null;
    });
    fitView();
  } catch (error) {
    showToast(`导入失败：${error.message}`, 'warning');
  } finally {
    importFile.value = '';
  }
});

svg.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest?.('.graph-node') || event.target.closest?.('.graph-relation')) return;
  selected = null;
  renderNodeList();
  renderInspector();
  const point = clientToSvg(event.clientX, event.clientY);
  view.panning = {
    pointerX: point.x,
    pointerY: point.y,
    x: view.x,
    y: view.y
  };
  svg.setPointerCapture(event.pointerId);
  canvasWrap.classList.add('dragging');
});

svg.addEventListener('pointermove', event => {
  if (view.linkDraft) {
    const point = clientToWorld(event.clientX, event.clientY);
    const target = findNodeAtWorldPoint(point, view.linkDraft.from);
    view.linkDraft.x = point.x;
    view.linkDraft.y = point.y;
    view.linkDraft.targetId = target?.id || null;
    renderGraph();
    return;
  }
  if (view.nodeDrag) {
    const point = clientToWorld(event.clientX, event.clientY);
    const node = nodeMap().get(view.nodeDrag.id);
    if (!node) return;
    const dx = point.x - view.nodeDrag.startX;
    const dy = point.y - view.nodeDrag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) view.nodeDrag.moved = true;
    const snapped = getSnappedPosition(node, view.nodeDrag.nodeX + dx, view.nodeDrag.nodeY + dy);
    node.x = snapped.x;
    node.y = snapped.y;
    view.snapGuides = snapped.guides;
    renderGraph();
    return;
  }
  if (!view.panning) return;
  const point = clientToSvg(event.clientX, event.clientY);
  view.x = view.panning.x + point.x - view.panning.pointerX;
  view.y = view.panning.y + point.y - view.panning.pointerY;
  renderGraph();
});

svg.addEventListener('pointerup', event => {
  if (view.linkDraft) {
    const point = clientToWorld(event.clientX, event.clientY);
    const draft = view.linkDraft;
    const target = findNodeAtWorldPoint(point, draft.from);
    view.linkDraft = null;
    if (!target) {
      renderGraph();
      showToast('已取消建立关系', 'warning');
      return;
    }
    if (target.type.includes('自然人')) {
      renderGraph();
      showToast('自然人不能作为股权关系的被投主体', 'warning');
      return;
    }
    const duplicate = graphData.links.some(link => link.from === draft.from && link.to === target.id);
    if (duplicate) {
      renderGraph();
      showToast('这条持股关系已经存在', 'warning');
      return;
    }
    const relationId = generateId('relation');
    selected = { kind: 'link', id: relationId };
    commit('已建立持股关系，请设置比例', () => {
      graphData.links.push({ id: relationId, from: draft.from, to: target.id, percent: '0%' });
    });
    startInlineRelationEdit(relationId);
    return;
  }
  if (view.nodeDrag) {
    const drag = view.nodeDrag;
    view.nodeDrag = null;
    view.snapGuides = null;
    if (drag.moved) {
      lastNodeClick = { id: null, time: 0 };
      historyStack.push(createHistoryEntry(false, drag.before));
      redoStack = [];
      view.justDragged = true;
      saveData();
      updateHistoryButtons();
      renderAll();
      showToast('节点位置已保存');
    } else {
      renderGraph();
    }
  }
  view.panning = null;
  canvasWrap.classList.remove('dragging');
});

svg.addEventListener('pointercancel', () => {
  if (!view.linkDraft) return;
  view.linkDraft = null;
  renderGraph();
});

svg.addEventListener('wheel', event => {
  event.preventDefault();
  const center = clientToSvg(event.clientX, event.clientY);
  setScale(event.deltaY < 0 ? view.scale * 1.1 : view.scale / 1.1, center.x, center.y);
}, { passive: false });

document.addEventListener('keydown', event => {
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if (sidebarMode === 'query' && ['F2', 'Delete', 'Backspace'].includes(event.key)) return;
  if (!editing && event.key === 'F2' && selected?.kind === 'node') {
    event.preventDefault();
    startInlineNodeEdit(selected.id);
    return;
  }
  if (!editing && event.key === 'F2' && selected?.kind === 'link') {
    event.preventDefault();
    startInlineRelationEdit(selected.id);
    return;
  }
  if (!editing && (event.key === 'Delete' || event.key === 'Backspace') && selected?.kind === 'node') {
    deleteSelectedNode();
  }
});

window.addEventListener('resize', () => renderGraph());
renderAll();
updateHistoryButtons();
