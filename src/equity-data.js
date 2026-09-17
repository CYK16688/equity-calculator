// 这里是图谱数据。修改名称、持股比例或新增节点后，浏览器会自动刷新。
export const equityData = {
  nodes: [
    {
      id: 'jack-li',
      name: 'Jack Li',
      type: '自然人股东',
      code: 'PERSON-001',
      note: '目标企业实际控制人',
      ribbon: { text: 'Controller', tone: 'controller' },
      x: 475,
      y: 20
    },
    {
      id: 'tom-yang',
      name: 'Tom Yang',
      type: '自然人股东',
      code: 'PERSON-002',
      note: '企业联合创始股东',
      x: 805,
      y: 20
    },
    {
      id: 'zeekr-tech',
      name: 'Zeekr Technology\nLimited',
      type: '控股平台',
      ownershipScope: 'complete',
      code: 'HK-2021-0086',
      note: '境外控股主体',
      x: 640,
      y: 175
    },
    {
      id: 'zeekr-root',
      name: 'Zhejiang Zeekr Intelligent Technology\nCo., Ltd.',
      type: '目标企业',
      ownershipScope: 'complete',
      code: '91330100MA2K****',
      note: '本图中心企业，可展开查看子公司',
      root: true,
      x: 585,
      y: 355
    },
    {
      id: 'shanghai-sales',
      name: 'Zeekr Automotive\n(Shanghai) Co., Ltd.',
      type: '参股企业',
      code: '91310115MA7****',
      note: '负责华东区域销售服务',
      x: 30,
      y: 585
    },
    {
      id: 'hangzhou-tech',
      name: 'Zeekr Intelligent\nTechnology (Hangzhou)\nCo., Ltd.',
      type: '参股企业',
      code: '91330108MA2****',
      note: '智能座舱与软件研发',
      x: 315,
      y: 585
    },
    {
      id: 'zhejiang-sales',
      name: 'Zhejiang Zeekr\nAutomotive Sales Co.,\nLtd.',
      type: '参股企业',
      code: '91330100MA2****',
      note: '整车销售与渠道运营',
      x: 600,
      y: 585
    },
    {
      id: 'research-center',
      name: 'Zhejiang Zeekr\nAutomotive Research\nand Development Co., Ltd.',
      type: '研发子公司',
      code: '91330201MA2****',
      note: '整车工程与前瞻技术研发',
      x: 885,
      y: 585
    },
    {
      id: 'foshan-sales',
      name: 'Foshan Zeekr\nAutomotive Sales\nService Co., Ltd.',
      type: '销售子公司',
      code: '91440605MA5****',
      note: '华南区域销售服务',
      x: 1170,
      y: 585
    },
    {
      id: 'weirui',
      name: 'Weirui Electric Vehicle\nEngineering (Ningbo)\nCo., Ltd.',
      type: '参股企业',
      code: '91330201MA2****',
      note: '电驱与工程技术服务',
      ribbon: { text: 'Risk', tone: 'risk' },
      x: 820,
      y: 800
    },
    {
      id: 'blue-energy',
      name: 'Shanghai Zeekr Blue\nNew Energy Technology\nCo., Ltd.',
      type: '新能源子公司',
      code: '91310115MA7****',
      note: '能源补给与充电服务',
      x: 1080,
      y: 800
    }
  ],
  links: [
    { from: 'jack-li', to: 'zeekr-tech', percent: '60%' },
    { from: 'tom-yang', to: 'zeekr-tech', percent: '40%' },
    { from: 'zeekr-tech', to: 'zeekr-root', percent: '100%' },
    { from: 'zeekr-root', to: 'shanghai-sales', percent: '21.5%' },
    { from: 'zeekr-root', to: 'hangzhou-tech', percent: '21.5%' },
    { from: 'zeekr-root', to: 'zhejiang-sales', percent: '21.5%' },
    { from: 'zeekr-root', to: 'research-center', percent: '21.5%' },
    { from: 'zeekr-root', to: 'foshan-sales', percent: '21.5%' },
    { from: 'research-center', to: 'weirui', percent: '21.5%' },
    { from: 'research-center', to: 'blue-energy', percent: '21.5%' }
  ]
};
