import { RGEventNames, RGLineShape, RGNodeShape } from '@relation-graph/web-components';
import nodeStyles from './node-styles.css?raw';
import './style.css';

const rgElement = document.getElementById('my-graph-component');
let graphInstance = null;

const graphOptions = {
  debug: true,
  defaultLineShape: RGLineShape.StandardStraight,
  defaultNodeShape: RGNodeShape.circle,
  defaultNodeWidth: 60,
  defaultNodeHeight: 60,
  defaultLineTextOnPath: true,
  layout: {
    layoutName: 'center',
    maxLayoutTimes: 3000
  },
  defaultExpandHolderPosition: 'right',
  reLayoutWhenExpandedOrCollapsed: true
};

const staticJsonData = {
  rootId: '2',
  nodes: [
    { id: '2', text: 'Initrode', width: 100, height: 100, data: { myicon: 'delivery_truck' } },
    { id: '1', text: 'Paper Street Soap Co.', data: { myicon: 'fries' } },
    { id: '3', text: 'Cyberdyne Systems', data: { myicon: 'football' } },
    { id: '4', text: 'Tyrell Corporation', data: { myicon: 'desktop' } },
    { id: '6', text: 'Weyland-Yutani', data: { myicon: 'fries' } },
    { id: '7', text: 'Hooli', data: { myicon: 'desktop' } },
    { id: '8', text: 'Vehement Capital', data: { myicon: 'football' } },
    { id: '9', text: 'Omni Consumer Products', data: { myicon: 'football' } },
    { id: '71', text: 'Stark Industries', data: { myicon: 'delivery_truck' } },
    { id: '72', text: 'Buy n Large', data: { myicon: 'fries' } },
    { id: '73', text: 'Binford Tools', data: { myicon: 'delivery_truck' } },
    { id: '81', text: 'Initech', data: { myicon: 'fries' } },
    { id: '82', text: 'Aperture Science', data: { myicon: 'desktop' } },
    { id: '83', text: 'Prestige Worldwide', data: { myicon: 'delivery_truck' } },
    { id: '84', text: 'Massive Dynamic', data: { myicon: 'football' } },
    { id: '85', text: 'Virtucon', data: { myicon: 'delivery_truck' } },
    { id: '91', text: 'Acme Corp', data: { myicon: 'football' } },
    { id: '92', text: 'Nakatomi Trading', data: { myicon: 'football' } },
    { id: '5', text: 'Los Pollos Hermanos', data: { myicon: 'burger' } }
  ],
  lines: [
    { id: 'l-1', from: '7', to: '71', text: 'Invest' },
    { id: 'l-2', from: '7', to: '72', text: 'Invest' },
    { id: 'l-3', from: '7', to: '73', text: 'Invest' },
    { id: 'l-4', from: '8', to: '81', text: 'Invest' },
    { id: 'l-5', from: '8', to: '82', text: 'Invest' },
    { id: 'l-6', from: '8', to: '83', text: 'Invest' },
    { id: 'l-7', from: '8', to: '84', text: 'Invest' },
    { id: 'l-8', from: '8', to: '85', text: 'Invest' },
    { id: 'l-9', from: '9', to: '91', text: 'Invest' },
    { id: 'l-10', from: '9', to: '92', text: 'Invest' },
    { id: 'l-11', from: '1', to: '2', text: 'Invest' },
    { id: 'l-12', from: '3', to: '1', text: 'Executive' },
    { id: 'l-13', from: '4', to: '2', text: 'Executive' },
    { id: 'l-14', from: '6', to: '2', text: 'Executive' },
    { id: 'l-15', from: '7', to: '2', text: 'Executive' },
    { id: 'l-16', from: '8', to: '2', text: 'Executive' },
    { id: 'l-17', from: '9', to: '2', text: 'Executive' },
    { id: 'l-18', from: '1', to: '5', text: 'Invest' }
  ]
};

const iconMap = {
  desktop: '🖥️',
  burger: '🍔',
  delivery_truck: '🚚',
  fries: '🍟',
  football: '🏆'
};

const escapeHtml = value =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeEventDetail = detail => (Array.isArray(detail) ? detail : [detail]);

const ensureShadowStyles = () => {
  const shadowRoot = rgElement.shadowRoot;
  if (!shadowRoot || shadowRoot.getElementById('simple-shadow-style')) return;
  const styleElement = document.createElement('style');
  styleElement.id = 'simple-shadow-style';
  styleElement.textContent = nodeStyles;
  shadowRoot.appendChild(styleElement);
};

const renderNode = node => {
  const text = escapeHtml(node?.text || '');
  if (node?.id === '2') {
    return `
      <div class="simple-root-node">
        <div class="simple-root-label">${text}</div>
      </div>
    `;
  }

  const icon = escapeHtml(iconMap[node?.data?.myicon] || '❓');
  return `
    <div class="simple-normal-node">
      <span aria-hidden="true">${icon}</span>
      <div class="simple-node-text">${text}</div>
    </div>
  `;
};

const initializeGraph = async () => {
  if (!graphInstance) return;
  await graphInstance.setJsonData(staticJsonData);
  graphInstance.moveToCenter();
  graphInstance.zoomToFit();
};

const bootstrap = async () => {
  rgElement.renderNode = renderNode;

  rgElement.addEventListener(RGEventNames.onReady, async event => {
    const [instance] = normalizeEventDetail(event.detail);
    if (!instance) return;
    graphInstance = instance;
    ensureShadowStyles();
    if (typeof graphInstance.updateOptions === 'function') {
      graphInstance.updateOptions(graphOptions);
    } else if (typeof graphInstance.setOptions === 'function') {
      graphInstance.setOptions(graphOptions);
    }
    await initializeGraph();
  });

  rgElement.addEventListener(RGEventNames.onNodeClick, event => {
    const [node] = normalizeEventDetail(event.detail);
    console.log('onNodeClick:', node?.text);
  });

  rgElement.addEventListener(RGEventNames.onLineClick, event => {
    const [line] = normalizeEventDetail(event.detail);
    console.log('onLineClick:', line?.text, line?.from, line?.to);
  });
};

bootstrap().catch(error => {
  console.error('[relation-graph-startup] bootstrap failed:', error);
});
