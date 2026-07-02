/**
   * AI 提取模块
   * 包含：
   *   1. Tesseract.js OCR（识别营业执照 / 商标图样）+ 图片预处理
   *   2. AI 视觉识别（OpenAI/DeepSeek GPT-4V，识别倾斜反光图片）
   *   3. GitHub API 抓取（仓库元信息 + README）
   *   4. 本地文件读取（File API 拿源码）
   *   5. LLM 提取（OpenAI 兼容协议，结构化输出）
   */
const AiExtract = (() => {

  // ====== 1. OCR ======
  let _tesseractWorker = null;

  async function getWorker() {
    if (_tesseractWorker) return _tesseractWorker;
    if (!window.Tesseract) throw new Error('Tesseract.js 未加载');
    _tesseractWorker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      // 中文简体 + 英文，识别营业执照够用
      logger: m => { /* 可以接到 UI 进度 */ }
    });
    return _tesseractWorker;
  }

  /**
   * OCR 营业执照图片，提取关键字段
   * 返回: { rawText, fields: { companyName, creditCode, legalRep, address, ... } }
   */
  async function ocrBusinessLicense(imageBlob) {
    // 1. 图片预处理(去反光 + 增强对比度)
    let processed = imageBlob;
    try {
      processed = await preprocessImage(imageBlob);
    } catch (e) {
      console.warn('[preprocessImage] failed, fallback', e);
    }

    // 2. 如果用户配了 OpenAI/DeepSeek key,优先用 AI 视觉(准确率高 10 倍)
    const settings = (typeof window !== 'undefined' && window.__ipbutlerSettings) || null;
    if (settings && settings.apiKey && settings.baseUrl) {
      try {
        const aiResult = await aiVisionBusinessLicense(processed, settings);
        if (aiResult && aiResult.fields && (aiResult.fields.companyName || aiResult.fields.creditCode)) {
          return aiResult;
        }
      } catch (e) {
        console.warn('[aiVision] failed, fallback to Tesseract', e.message);
      }
    }

    // 3. 兜底:Tesseract OCR
    const worker = await getWorker();
    const { data } = await worker.recognize(processed);
    const text = data.text || '';
    return {
      rawText: text,
      fields: parseBusinessLicenseText(text)
    };
  }

  // ============ 图片预处理 ============
  // Canvas:灰度 + 自适应阈值(去反光/去噪) + 高对比度
  async function preprocessImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise(function (resolve, reject) {
        const i = new Image();
        i.onload = function () { resolve(i); };
        i.onerror = reject;
        i.src = url;
      });

      const w = img.naturalWidth, h = img.naturalHeight;
      if (w < 50 || h < 50) return blob;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const len = w * h;

      // 1. 转灰度
      const gray = new Uint8ClampedArray(len);
      for (let i = 0; i < len; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        gray[i] = (r * 299 + g * 587 + b * 114) / 1000;
      }

      // 2. 自适应阈值(局部均值) — 去反光
      const winSize = 12;
      const result = new Uint8ClampedArray(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0, count = 0;
          const yStart = Math.max(0, y - winSize);
          const yEnd = Math.min(h, y + winSize + 1);
          const xStart = Math.max(0, x - winSize);
          const xEnd = Math.min(w, x + winSize + 1);
          for (let yy = yStart; yy < yEnd; yy++) {
            for (let xx = xStart; xx < xEnd; xx++) {
              sum += gray[yy * w + xx];
              count++;
            }
          }
          const mean = sum / count;
          const threshold = mean * 0.82;
          result[y * w + x] = gray[y * w + x] < threshold ? 0 : 255;
        }
      }

      // 3. 写回 canvas
      for (let i = 0; i < len; i++) {
        const v = result[i];
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      // 4. 转 PNG(无损,适合文字)
      return await new Promise(function (resolve) {
        canvas.toBlob(function (b) { resolve(b || blob); }, 'image/png', 0.95);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ============ AI 视觉识别 (GPT-4V / DeepSeek-VL / Qwen-VL) ============
  async function aiVisionBusinessLicense(blob, settings) {
    // blob → base64 dataURL
    const dataUrl = await new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

    const baseUrl = (settings.baseUrl || '').replace(/\/+$/, '');
    const url = baseUrl + '/chat/completions';
    const prompt = '这是一张中国营业执照图片。请仔细识别并提取以下字段,以 JSON 格式返回:\n' +
      '{\n' +
      '  "companyName": "公司全称",\n' +
      '  "creditCode": "统一社会信用代码(18位字母数字)",\n' +
      '  "companyType": "公司类型(如:有限责任公司)",\n' +
      '  "legalRep": "法定代表人姓名",\n' +
      '  "address": "住所/经营场所地址",\n' +
      '  "registeredCapital": "注册资本(含单位)",\n' +
      '  "establishedDate": "成立日期(YYYY-MM-DD)",\n' +
      '  "businessScope": "经营范围",\n' +
      '  "businessTerm": "营业期限"\n' +
      '}\n' +
      '注意:即使图片倾斜或有反光也要尽量识别,字段为空时返回空字符串。只返回 JSON,不要其他解释。';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + settings.apiKey
      },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }],
        max_tokens: 800,
        temperature: 0.1
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('Vision API ' + resp.status + ': ' + err.slice(0, 200));
    }
    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
    if (!content) throw new Error('Vision API 返回空');

    // 解析 JSON
    let parsed;
    try {
      const m = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/) || content.match(/\{[\s\S]+\}/);
      const jsonStr = m ? (m[1] || m[0]) : content;
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Vision JSON 解析失败: ' + content.slice(0, 200));
    }

    return {
      rawText: content,
      fields: {
        companyName: parsed.companyName || '',
        creditCode: parsed.creditCode || '',
        companyType: parsed.companyType || '',
        legalRep: parsed.legalRep || '',
        address: parsed.address || '',
        registeredCapital: parsed.registeredCapital || '',
        establishedDate: parsed.establishedDate || '',
        businessScope: parsed.businessScope || '',
        businessTerm: parsed.businessTerm || ''
      }
    };
  }

  function parseBusinessLicenseText(text) {
    const result = {
      companyName: '',
      creditCode: '',
      legalRep: '',
      address: '',
      registeredCapital: '',
      companyType: ''
    };

    // 统一社会信用代码：18 位字母数字组合
    const creditMatch = text.match(/[0-9A-Z]{18}/);
    if (creditMatch) result.creditCode = creditMatch[0];

    // 名称：含"有限公司" / "股份有限公司" / "有限责任公司" / "集团" 等
    const nameMatch = text.match(/名称[：:]\s*([^\n]+)/) ||
                      text.match(/([^\n]*?(?:有限公司|股份有限公司|有限责任公司|集团|公司))/);
    if (nameMatch) result.companyName = nameMatch[1].trim();

    // 法定代表人
    const repMatch = text.match(/法定代表人[：:]\s*([^\s\n]+)/) ||
                     text.match(/法人[：:]\s*([^\s\n]+)/) ||
                     text.match(/经营者[：:]\s*([^\s\n]+)/);
    if (repMatch) result.legalRep = repMatch[1].trim();

    // 住所 / 地址
    const addrMatch = text.match(/(?:住所|地址)[：:]\s*([^\n]+)/);
    if (addrMatch) result.address = addrMatch[1].trim();

    // 注册资本
    const capMatch = text.match(/注册资本[：:]\s*([^\n]+)/);
    if (capMatch) result.registeredCapital = capMatch[1].trim();

    return result;
  }

  // ====== 2. GitHub ======
  /**
   * 解析 GitHub URL：https://github.com/owner/repo
   */
  function parseGithubUrl(url) {
    const m = String(url).match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git|\/.*)?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  }

  /**
   * 拉取 GitHub 仓库元信息 + README
   */
  async function fetchGithub(url) {
    const parsed = parseGithubUrl(url);
    if (!parsed) throw new Error('GitHub URL 格式不对，应为 https://github.com/owner/repo');

    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    // 如果用户配了 GitHub token，附上（提升 rate limit）
    const token = localStorage.getItem('ip-butler-github-token');
    if (token) headers['Authorization'] = `token ${token}`;

    // 仓库元信息
    const repoResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers });
    if (!repoResp.ok) throw new Error(`GitHub API 错误: ${repoResp.status}（私有仓库需要 token，请到设置配置）`);
    const repo = await repoResp.json();

    // README
    let readme = '';
    try {
      const readmeResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`, { headers });
      if (readmeResp.ok) {
        const data = await readmeResp.json();
        if (data.content) {
          readme = atob(data.content.replace(/\n/g, ''));
        }
      }
    } catch (e) { /* README 缺失无所谓 */ }

    // 语言统计
    let languages = {};
    try {
      const langResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/languages`, { headers });
      if (langResp.ok) languages = await langResp.json();
    } catch (e) {}

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description || '',
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language,
      languages,
      license: repo.license ? (repo.license.spdx_id || repo.license.name) : '',
      homepage: repo.homepage || '',
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      defaultBranch: repo.default_branch,
      topics: repo.topics || [],
      readme: readme.slice(0, 8000) // 截断
    };
  }

  // ====== 3. 本地文件 ======
  /**
   * 读取用户通过文件选择器选的源码文件夹
   * 返回 { files: [{name, size, text, lines}], totalLines, totalSize }
   */
  async function readSourceFiles(fileList) {
    const files = [];
    let totalLines = 0;
    let totalSize = 0;

    // 支持的源码后缀
    const codeExts = /\.(py|js|ts|jsx|tsx|java|cpp|c|h|hpp|cs|go|rs|php|rb|swift|kt|html|css|json|xml|yaml|yml|md|sh|sql|vue|svelte|mjs|cjs|tsx|jsx|dart|lua|r|pl|sh|tcl|vim|sql|graphql)$/i;

    for (const file of fileList) {
      if (!codeExts.test(file.name)) continue;
      // 跳过超大文件
      if (file.size > 2 * 1024 * 1024) continue; // > 2MB 跳过
      const text = await file.text();
      const lines = text.split(/\r?\n/).length;
      files.push({ name: file.webkitRelativePath || file.name, size: file.size, text, lines });
      totalLines += lines;
      totalSize += file.size;
    }
    return { files, totalLines, totalSize };
  }

  // ====== 4. LLM 提取 ======
  /**
   * 调用 LLM 提取结构化信息
   * userSettings: { baseUrl, apiKey, model }
   * input: { type: 'trademark'|'software', text, githubData, ocrData, sourceFilesData }
   */
  async function llmExtract(type, input, settings) {
    if (!settings || !settings.apiKey) {
      throw new Error('请先在右上角设置里填入 API Key（OpenAI / DeepSeek / 阿里通义等兼容协议）');
    }

    // 拼接所有可用信息
    const context = [];

    if (input.ocrText) {
      context.push(`【营业执照 OCR 识别结果】\n${input.ocrText}`);
    }
    if (input.github) {
      const g = input.github;
      context.push(`【GitHub 仓库信息】
仓库：${g.fullName}
描述：${g.description}
主语言：${g.language}
License：${g.license}
创建时间：${g.createdAt}
Topics：${(g.topics || []).join(', ')}
README（前 3000 字）：
${(g.readme || '').slice(0, 3000)}`);
    }
    if (input.sourceFiles && input.sourceFiles.length > 0) {
      const summary = input.sourceFiles.slice(0, 30).map(f => `- ${f.name} (${f.lines} 行)`).join('\n');
      context.push(`【源码文件】（共 ${input.sourceFiles.length} 个，${input.totalLines} 行）
${summary}

主要代码片段（前 2 个文件的前 2000 字）：
${input.sourceFiles.slice(0, 2).map(f => `\n### ${f.name} ###\n${f.text.slice(0, 2000)}`).join('\n')}`);
    }
    if (input.freeText) {
      context.push(`【用户自述】\n${input.freeText}`);
    }

    const systemPrompt = `你是专业的商标 / 软著申请顾问。根据用户提供的信息，提取并整理出 ${type === 'trademark' ? '商标' : '软件著作权'} 申请所需的所有字段。

严格要求：
1. **只输出 JSON**，不要任何解释或 Markdown 标记
2. **不要编造**——找不到的字段填空字符串 ''
3. **字段命名严格遵守**下方 schema
4. 商标类型只能是 文字 / 图形 / 字母 / 数字 / 三维 / 组合 之一
5. 商标类别必须是 1-45 之间的整数（Nice 分类）
6. 软著语言要写具体名称（Python / JavaScript / Java / C++ / Go 等）`;

    const schema = type === 'trademark' ? `{
  "trademarkName": "商标名称（建议简洁 2-6 字）",
  "trademarkType": "文字 / 图形 / 字母 / 数字 / 三维 / 组合",
  "category": 1 至 45 的整数,
  "categoryReason": "为什么选这个类别（基于用户的商品/服务）",
  "goods": "[XXXX] 商品1；商品2；商品3\\n[YYYY] 商品4",
  "description": "商标含义 / 用途说明"
}` : `{
  "softwareName": "软件全称（带 V1.0 后缀；不能与已有软著同名）",
  "abbreviation": "软件简称",
  "version": "1.0.0",
  "completionDate": "YYYY-MM-DD（开发完成日期）",
  "firstPublishDate": "YYYY-MM-DD 或留空",
  "publishStatus": "已发表 / 未发表",
  "language": "Python / JavaScript / Java 等",
  "totalLines": 整数,
  "features": "技术特点 / 主要功能（150-300 字）",
  "rightWay": "原始 / 继承 / 受让",
  "handleWay": "自办 / 代理"
}`;

    const userPrompt = `请根据以下信息，提取${type === 'trademark' ? '商标' : '软件著作权'}申请字段：

${context.join('\n\n')}

字段 schema：
${schema}

直接输出 JSON：`;

    // 调 API
    const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = settings.model || 'gpt-4o-mini';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`LLM API 错误 (${resp.status}): ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 没返回有效 JSON：' + content.slice(0, 200));
    return JSON.parse(jsonMatch[0]);
  }

  // ====== 5. 智能分类推荐（无 LLM 时的 fallback） ======
  /**
   * 基于关键词推荐商标 Nice 分类
   */
  function suggestCategory(text) {
    const lower = String(text || '').toLowerCase();
    const rules = [
      { kw: ['软件', 'app', '代码', '开发', '编程', 'saas', '系统', '平台', '网站', '小程序', '计算机', '云', '数据', '算法', 'ai', '人工智能', '科技'], cat: 42, label: '科技服务' },
      { kw: ['广告', '营销', '品牌', '推广', '策划'], cat: 35, label: '广告商业' },
      { kw: ['教育', '培训', '课程', '学校', '教学'], cat: 41, label: '教育娱乐' },
      { kw: ['食品', '零食', '饮料', '茶', '酒', '咖啡', '吃', '餐厅', '餐饮', '外卖'], cat: 30, label: '茶糖糕点' },
      { kw: ['服装', '衣服', '鞋子', '帽子', '袜', '时装'], cat: 25, label: '服装鞋帽' },
      { kw: ['家具', '沙发', '床', '桌椅'], cat: 20, label: '家具' },
      { kw: ['美妆', '化妆', '护肤', '香水', '美容', '面膜', '口红'], cat: 3, label: '日化用品' },
      { kw: ['玩具', '游戏', '体育', '健身'], cat: 28, label: '玩具用品' },
      { kw: ['首饰', '珠宝', '项链', '戒指', '手表'], cat: 14, label: '珠宝钟表' },
      { kw: ['书', '出版', '印刷', '文具'], cat: 16, label: '办公用品' },
      { kw: ['物流', '快递', '运输', '仓储', '货运'], cat: 39, label: '运输配送' },
      { kw: ['医疗', '医院', '诊所', '药品', '药', '健康'], cat: 5, label: '医药' },
      { kw: ['酒店', '民宿', '住宿', '旅馆'], cat: 43, label: '餐饮住宿' },
      { kw: ['金融', '银行', '贷款', '支付', '保险', '投资'], cat: 36, label: '金融保险' },
      { kw: ['电商', '零售', '批发', '销售', '商城', '店铺'], cat: 35, label: '广告商业' },
      { kw: ['建站', '装修', '建筑', '工程', '施工'], cat: 37, label: '建筑修理' }
    ];
    for (const r of rules) {
      if (r.kw.some(k => lower.includes(k))) return r;
    }
    return { cat: 42, label: '科技服务' }; // 默认
  }

  // ====== 6. 商标专业评估 ======
  /**
   * AI 商标创意生成：基于产品描述生成 5-10 个商标候选
   */
  async function generateTrademarkIdeas(input, settings) {
    if (!settings || !settings.apiKey) {
      throw new Error('请先配置 API Key');
    }
    const systemPrompt = `你是资深品牌策划师 + 商标代理人，擅长为中国市场创意商标名。要求：
1. **简短好记**：2-4 字最佳，最多 6 字
2. **可注册性高**：避免描述性/通用词/地名/行业词
3. **多风格**：中文/英文/谐音/缩写/造字混搭
4. **可申请图形**：名字本身有视觉化潜力
5. **避开常见近似词**：避免"智""慧""云""数"等烂大街的字`;
    const userPrompt = `基于以下产品/服务描述，生成 8 个商标候选名字：

【产品/服务】${input.product || '（未提供）'}
【行业】${input.industry || '（未提供）'}
【目标客户】${input.target || '（未提供）'}
【品牌调性】${input.tone || '专业、简洁、现代'}
【已用名（如有）】${input.existing || '（无）'}
【希望的方向】${input.direction || '不限'}

按以下 JSON 输出：
{
  "ideas": [
    {
      "name": "商标名（2-6字）",
      "type": "中文 / 英文 / 谐音 / 缩写 / 造字",
      "meaning": "含义说明（10字内）",
      "suitable_for": "适合的产品/调性（10字内）",
      "register_score": 0-100 可注册性评分
    }
  ],
  "rationale": "整体命名策略说明（1-2句话）"
}`;

    const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = settings.model || 'gpt-4o-mini';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' }
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`LLM API 错误 (${resp.status}): ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 没返回有效 JSON：' + content.slice(0, 200));
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * AI 商标专业评估：驳回风险 + 近似风险 + 类别建议 + 整体评分
   */
  async function analyzeTrademark(input, settings) {
    if (!settings || !settings.apiKey) {
      throw new Error('请先配置 API Key');
    }
    const systemPrompt = `你是资深中国商标代理人（10 年经验），熟悉商标局审查标准、《商标法》及尼斯分类。基于用户提供的商标信息，给出专业评估。严格只输出 JSON。`;
    const userPrompt = `请评估以下商标申请：

【商标名称】${input.name}
【商标类型】${input.type}
【已选类别】第 ${input.categories.join('、第 ')} 类（共 ${input.categories.length} 类）
【商品/服务项目】
${input.goods || '（未填）'}
【用途/描述】${input.description || '（未填）'}

按以下 schema 输出 JSON：
{
  "score": 0-100 综合评分（越高越容易通过）,
  "risk_level": "low/medium/high（驳回风险等级）",
  "risk_reasons": ["驳回原因1", "驳回原因2"],
  "similar_risk": "可能的近似/在先商标风险描述（基于名称特征）",
  "category_advice": "类别选择建议（是否需要增/删）",
  "goods_advice": "商品/服务选择建议（过宽/过窄/合理）",
  "priority_checklist": ["提交前必查项1", "必查项2"],
  "overall": "总体建议（1-2 句话）"
}`;

    const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = settings.model || 'gpt-4o-mini';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`LLM API 错误 (${resp.status}): ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 没返回有效 JSON：' + content.slice(0, 200));
    return JSON.parse(jsonMatch[0]);
  }

  return {
    ocrBusinessLicense,
    fetchGithub,
    parseGithubUrl,
    readSourceFiles,
    llmExtract,
    suggestCategory,
    analyzeTrademark,
    generateTrademarkIdeas
  };
})();
