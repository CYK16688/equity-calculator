// 这里是完全虚构的演示数据，不包含真实企业或个人信息。
export const equityData = {
  nodes: [
    {
      id: 'founder-a',
      name: 'Demo Founder A',
      type: '自然人股东',
      code: 'DEMO-PERSON-001',
      note: '演示用实际控制人',
      ribbon: { text: 'Controller', tone: 'controller' },
      x: 475,
      y: 20
    },
    {
      id: 'founder-b',
      name: 'Demo Founder B',
      type: '自然人股东',
      code: 'DEMO-PERSON-002',
      note: '演示用联合创始股东',
      x: 805,
      y: 20
    },
    {
      id: 'alpha-holdings',
      name: 'Alpha Holdings\nLtd.',
      type: '控股平台',
      ownershipScope: 'complete',
      code: 'DEMO-COMPANY-001',
      note: '演示用控股平台',
      x: 640,
      y: 175
    },
    {
      id: 'target-tech',
      name: 'Target Technology\nCo., Ltd.',
      type: '目标企业',
      ownershipScope: 'complete',
      code: 'DEMO-COMPANY-002',
      note: '演示用中心企业，可展开查看子公司',
      root: true,
      x: 585,
      y: 355
    },
    {
      id: 'east-sales',
      name: 'East Region Sales\nCo., Ltd.',
      type: '参股企业',
      code: 'DEMO-COMPANY-003',
      note: '演示用区域销售服务主体',
      x: 30,
      y: 585
    },
    {
      id: 'smart-rd',
      name: 'Smart Research\nand Development\nCo., Ltd.',
      type: '参股企业',
      code: 'DEMO-COMPANY-004',
      note: '演示用软件研发主体',
      x: 315,
      y: 585
    },
    {
      id: 'channel-ops',
      name: 'Channel Operations\nCo., Ltd.',
      type: '参股企业',
      code: 'DEMO-COMPANY-005',
      note: '演示用渠道运营主体',
      x: 600,
      y: 585
    },
    {
      id: 'engineering-center',
      name: 'Engineering\nResearch Center',
      type: '研发子公司',
      code: 'DEMO-COMPANY-006',
      note: '演示用工程研发主体',
      x: 885,
      y: 585
    },
    {
      id: 'south-sales',
      name: 'South Region Sales\nService Co., Ltd.',
      type: '销售子公司',
      code: 'DEMO-COMPANY-007',
      note: '演示用区域销售服务主体',
      x: 1170,
      y: 585
    },
    {
      id: 'engineering-services',
      name: 'Engineering Services\nCo., Ltd.',
      type: '参股企业',
      code: 'DEMO-COMPANY-008',
      note: '演示用工程技术服务主体',
      ribbon: { text: 'Risk', tone: 'risk' },
      x: 820,
      y: 800
    },
    {
      id: 'energy-services',
      name: 'Energy Services\nCo., Ltd.',
      type: '新能源子公司',
      code: 'DEMO-COMPANY-009',
      note: '演示用能源服务主体',
      x: 1080,
      y: 800
    }
  ],
  links: [
    { from: 'founder-a', to: 'alpha-holdings', percent: '60%' },
    { from: 'founder-b', to: 'alpha-holdings', percent: '40%' },
    { from: 'alpha-holdings', to: 'target-tech', percent: '100%' },
    { from: 'target-tech', to: 'east-sales', percent: '21.5%' },
    { from: 'target-tech', to: 'smart-rd', percent: '21.5%' },
    { from: 'target-tech', to: 'channel-ops', percent: '21.5%' },
    { from: 'target-tech', to: 'engineering-center', percent: '21.5%' },
    { from: 'target-tech', to: 'south-sales', percent: '21.5%' },
    { from: 'engineering-center', to: 'engineering-services', percent: '21.5%' },
    { from: 'engineering-center', to: 'energy-services', percent: '21.5%' }
  ]
};
