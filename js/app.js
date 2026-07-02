/**
 * 知产管家 - 主应用 v0.7
 * 智能填报：图片 OCR + GitHub + 源码 + 文字 → AI 自动提取
 * 商标：AI 起名 + 风险评估 + 自动选类 + 自动勾选类似群组
 */
const { createApp, ref, reactive, onMounted } = Vue;

const app = createApp({
  setup() {
    // ===== 状态 =====
    const mode = ref('trademark');
    const activeTab = ref('image');
    const loading = ref(false);
    const loadingMsg = ref('');
    const progress = ref(0);

    const inputs = reactive({
      imageBlob: null, imagePreview: null, imageDims: null,
      imageOcrText: '', imageFields: null,
      githubUrl: '', githubData: null,
      sourceFiles: [], sourceTotalLines: 0,
      freeText: ''
    });

    const result = reactive({
      fields: {},
      categories: [42],
      selectedSubclasses: {},
      applicant: {
        type: 'company', name: '', creditCode: '',
        legalRep: '', address: '', phone: '', email: ''
      }
    });

    const settings = reactive({
      apiKey: '', baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini', githubToken: ''
    });

    const showSettings = ref(false);
    const showSubmitHelp = ref(false);
    const showIdeaPanel = ref(false);
    const ideaParams = reactive({ product: '', industry: '', target: '', tone: '专业简洁', existing: '', direction: '' });
    const ideaResults = ref(null);

    // ===== 设置 =====
    function saveSettings() {
      try {
        localStorage.setItem('ip-butler-settings', JSON.stringify({
          apiKey: settings.apiKey, baseUrl: settings.baseUrl,
          model: settings.model, githubToken: settings.githubToken
        }));
      } catch (e) {}
      // 暴露给 ai-extract.js 用于 GPT-4V 视觉识别
      window.__ipbutlerSettings = {
        apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model
      };
      showSettings.value = false;
      if (window.__showToast) window.__showToast('设置已保存', 'success');
    }

    function loadSettings() {
      try {
        const s = JSON.parse(localStorage.getItem('ip-butler-settings') || '{}');
        if (s.apiKey) settings.apiKey = s.apiKey;
        if (s.baseUrl) settings.baseUrl = s.baseUrl;
        if (s.model) settings.model = s.model;
        if (s.githubToken) settings.githubToken = s.githubToken;
      } catch (e) {}
      // 同步暴露给 ai-extract.js 用于 GPT-4V 视觉识别
      window.__ipbutlerSettings = {
        apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model
      };
    }

    // ===== 输入处理 =====
    // 统一加载图片:自动调 AI 适配到商标局标准(800x800 JPG)
    async function loadAndFitImage(file, opts) {
      opts = opts || {};
      if (!file.type.startsWith('image/')) {
        if (window.__showToast) window.__showToast('请上传图片文件', 'error');
        return;
      }
      // 用 AI 适配(商标图样 + 软著营业执照都合适)
      if (window.AITrademarkImage && window.AITrademarkImage.autoFitToStandard) {
        try {
          if (window.__showToast) window.__showToast('⏳ AI 智能适配中...', 'info', 1500);
          var fit = await window.AITrademarkImage.autoFitToStandard(file);
          inputs.imageBlob = fit.blob;
          inputs.imagePreview = fit.dataUrl;
          inputs.imageDims = { w: fit.result.w, h: fit.result.h };
          var orig = fit.original;
          var msg = '✓ 已适配商标局标准: ' + orig.w + '×' + orig.h + ' (' + (orig.size/1024).toFixed(0) + 'KB) → ' + fit.result.w + '×' + fit.result.h + ' (' + (fit.result.size/1024).toFixed(0) + 'KB JPG)';
          if (window.__showToast) window.__showToast(msg, 'success', 4000);
          if (opts.onLoad) opts.onLoad(fit);
        } catch (e) {
          // fallback: 直接读
          inputs.imageBlob = file;
          var r = new FileReader();
          r.onload = function () {
            inputs.imagePreview = r.result;
            var img = new Image();
            img.onload = function () { inputs.imageDims = { w: img.width, h: img.height }; };
            img.src = r.result;
          };
          r.readAsDataURL(file);
        }
      } else {
        // 没 AI 模块时降级
        inputs.imageBlob = file;
        var r2 = new FileReader();
        r2.onload = function () {
          inputs.imagePreview = r2.result;
          var img2 = new Image();
          img2.onload = function () { inputs.imageDims = { w: img2.width, h: img2.height }; checkImageSpec(); };
          img2.src = r2.result;
        };
        r2.readAsDataURL(file);
      }
    }

    function handleImageUpload(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        if (window.__showToast) window.__showToast('请上传图片文件', 'error');
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        if (window.__showToast) window.__showToast('图片超过 20MB', 'warn');
        return;
      }
      loadAndFitImage(file);
    }

    function checkImageSpec() {
      if (!inputs.imageDims) return;
      const { w, h } = inputs.imageDims;
      if (w < 591 || h < 591) {
        if (window.__showToast) window.__showToast('像素过小，建议 ≥ 591×591，当前 ' + w + '×' + h, 'warn');
      } else if (w > 1181 && h > 1181) {
        if (window.__showToast) window.__showToast('像素较大。当前 ' + w + '×' + h, 'warn');
      } else {
        if (window.__showToast) window.__showToast('✓ 图样尺寸合规: ' + w + '×' + h, 'success');
      }
    }

    function handleImageDrop(e) {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file || !file.type.startsWith('image/')) {
        if (window.__showToast) window.__showToast('请拖入图片文件', 'error');
        return;
      }
      loadAndFitImage(file);
    }

    async function runOcr() {
      if (!inputs.imageBlob) {
        if (window.__showToast) window.__showToast('请先上传图片', 'error');
        return;
      }
      loading.value = true;
      loadingMsg.value = '正在 OCR 识别...';
      try {
        const res = await AiExtract.ocrBusinessLicense(inputs.imageBlob);
        inputs.imageOcrText = res.rawText;
        inputs.imageFields = res.fields;
        if (res.fields.companyName) result.applicant.name = res.fields.companyName;
        if (res.fields.creditCode) result.applicant.creditCode = res.fields.creditCode;
        if (res.fields.legalRep) result.applicant.legalRep = res.fields.legalRep;
        if (res.fields.address) result.applicant.address = res.fields.address;
        if (res.fields.companyName) result.applicant.type = 'company';
        if (window.__showToast) window.__showToast('OCR 识别完成', 'success');
      } catch (e) {
        if (window.__showToast) window.__showToast('OCR 失败：' + e.message, 'error');
      } finally {
        loading.value = false;
      }
    }

    async function fetchGithubData() {
      if (!inputs.githubUrl) {
        if (window.__showToast) window.__showToast('请输入 GitHub 仓库 URL', 'error');
        return;
      }
      loading.value = true;
      loadingMsg.value = '正在抓取 GitHub 仓库...';
      try {
        inputs.githubData = await AiExtract.fetchGithub(inputs.githubUrl);
        if (window.__showToast) window.__showToast('抓取完成：' + inputs.githubData.fullName, 'success');
      } catch (e) {
        if (window.__showToast) window.__showToast('抓取失败：' + e.message, 'error');
      } finally {
        loading.value = false;
      }
    }

    async function handleSourceFolder(e) {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length === 0) return;
      loading.value = true;
      loadingMsg.value = '正在读取源码文件...';
      try {
        const res = await AiExtract.readSourceFiles(files);
        inputs.sourceFiles = res.files;
        inputs.sourceTotalLines = res.totalLines;
        if (window.__showToast) window.__showToast(`已读取 ${res.files.length} 个文件，${res.totalLines} 行`, 'success');
      } catch (e) {
        if (window.__showToast) window.__showToast('读取失败：' + e.message, 'error');
      } finally {
        loading.value = false;
      }
    }

    function removeSourceFile(idx) {
      inputs.sourceFiles.splice(idx, 1);
      inputs.sourceTotalLines = inputs.sourceFiles.reduce((s, f) => s + f.lines, 0);
    }

    function clearAll() {
      if (!confirm('清空当前所有输入和提取结果？')) return;
      inputs.imageBlob = null;
      inputs.imagePreview = null;
      inputs.imageDims = null;
      inputs.imageOcrText = '';
      inputs.imageFields = null;
      inputs.githubUrl = '';
      inputs.githubData = null;
      inputs.sourceFiles = [];
      inputs.sourceTotalLines = 0;
      inputs.freeText = '';
      result.fields = {};
      result.selectedSubclasses = {};
      result.categories = [42];
      result.applicant = { type: 'company', name: '', creditCode: '', legalRep: '', address: '', phone: '', email: '' };
      if (window.__showToast) window.__showToast('已清空', 'success');
    }

    // ===== AI 提取 =====
    async function runAiExtract() {
      const hasAny = inputs.imageOcrText || inputs.githubData ||
                     (inputs.sourceFiles && inputs.sourceFiles.length) ||
                     inputs.freeText;
      if (!hasAny) {
        if (window.__showToast) window.__showToast('请先输入数据', 'warn');
        return;
      }
      if (!settings.apiKey) {
        if (window.__showToast) window.__showToast('请先配置 API Key', 'error');
        showSettings.value = true;
        return;
      }
      loading.value = true;
      loadingMsg.value = 'AI 正在智能提取...';
      progress.value = 30;
      try {
        const ctx = {
          ocrText: inputs.imageOcrText,
          github: inputs.githubData,
          sourceFiles: inputs.sourceFiles,
          totalLines: inputs.sourceTotalLines,
          freeText: inputs.freeText
        };
        const extracted = await AiExtract.llmExtract(mode.value, ctx, settings);
        progress.value = 90;

        if (mode.value === 'trademark') {
          result.fields.trademarkName = extracted.trademarkName || '';
          result.fields.trademarkType = extracted.trademarkType || '文字';
          const cats = Array.isArray(extracted.categories) ? extracted.categories :
                       extracted.category ? [extracted.category] : [42];
          result.categories = cats.filter(c => c >= 1 && c <= 45);
          if (result.categories.length === 0) result.categories = [42];
          result.fields.goods = extracted.goods || '';
          result.fields.description = extracted.description || '';

          // 反向解析 goods → selectedSubclasses
          result.selectedSubclasses = {};
          (extracted.goods || '').split('\n').forEach(line => {
            const m = line.match(/\[(\d{4})\]\s*(.+)/);
            if (!m) return;
            const catCode = m[1];
            const catNum = parseInt(catCode, 10);
            m[2].split(/[；;]/).forEach(item => {
              item = item.trim();
              if (!item) return;
              const subs = NiceClasses.getSubclasses(catNum);
              subs.forEach(g => {
                if (g.items.includes(item)) {
                  result.selectedSubclasses[catCode + '::' + g.code + '::' + item] = true;
                }
              });
            });
          });
          const matched = Object.keys(result.selectedSubclasses).length;
          if (matched > 0 && window.__showToast) {
            window.__showToast('✓ AI 已自动勾选 ' + matched + ' 项类似群组', 'success');
          }
        } else {
          result.fields.softwareName = extracted.softwareName || '';
          result.fields.abbreviation = extracted.abbreviation || '';
          result.fields.version = extracted.version || '1.0.0';
          result.fields.completionDate = extracted.completionDate || new Date().toISOString().slice(0, 10);
          result.fields.firstPublishDate = extracted.firstPublishDate || '';
          result.fields.publishStatus = extracted.publishStatus || '未发表';
          result.fields.language = extracted.language || '';
          result.fields.totalLines = extracted.totalLines || inputs.sourceTotalLines;
          result.fields.features = extracted.features || '';
          result.fields.rightWay = extracted.rightWay || '原始';
          result.fields.handleWay = extracted.handleWay || '自办';
        }

        progress.value = 100;
        if (window.__showToast) window.__showToast('AI 提取完成', 'success');
      } catch (e) {
        if (window.__showToast) window.__showToast('提取失败：' + e.message, 'error');
      } finally {
        loading.value = false;
        progress.value = 0;
      }
    }

    function suggestCategoryFallback() {
      const text = (inputs.imageOcrText || '') + ' ' +
                   (inputs.githubData ? (inputs.githubData.description + ' ' +
                    (inputs.githubData.topics || []).join(' ')) : '') +
                   ' ' + inputs.freeText;
      const sug = AiExtract.suggestCategory(text);
      result.categories = [sug.cat];
      if (window.__showToast) window.__showToast('已推荐：第 ' + sug.cat + ' 类 ' + sug.label, 'success');
    }

    // ===== AI 起名 =====
    function generateIdeas() {
      if (!settings.apiKey) {
        showSettings.value = true;
        if (window.__showToast) window.__showToast('请先配置 API Key', 'error');
        return;
      }
      showIdeaPanel.value = true;
      const ctx = [
        inputs.imageOcrText ? '[营业执照] ' + inputs.imageOcrText.slice(0, 200) : '',
        inputs.githubData ? '[GitHub] ' + inputs.githubData.fullName + ' - ' + inputs.githubData.description : '',
        inputs.freeText ? '[描述] ' + inputs.freeText.slice(0, 300) : '',
        result.fields.description ? '[说明] ' + result.fields.description : ''
      ].filter(Boolean).join('\n');
      if (!ideaParams.product) ideaParams.product = ctx || '请描述你的产品/服务';
    }

    async function fetchIdeas() {
      loading.value = true;
      loadingMsg.value = 'AI 正在想商标名...';
      try {
        ideaResults.value = await AiExtract.generateTrademarkIdeas(ideaParams, settings);
        if (window.__showToast) window.__showToast('✓ 生成 ' + (ideaResults.value.ideas || []).length + ' 个候选', 'success');
      } catch (e) {
        if (window.__showToast) window.__showToast('生成失败：' + e.message, 'error');
      } finally {
        loading.value = false;
      }
    }

    function pickIdea(idea) {
      result.fields.trademarkName = idea.name;
      result.fields.description = (result.fields.description || '') +
        (result.fields.description ? '\n' : '') +
        '【AI 候选】' + idea.name + '：' + (idea.meaning || '') + '（' + (idea.type || '') + '）';
      showIdeaPanel.value = false;
      if (window.__showToast) window.__showToast('已采用：' + idea.name, 'success');
    }

    // ===== PDF 生成 =====
    function generatePdf() {
      if (mode.value === 'trademark') generateTrademarkPdf();
      else generateSoftwarePdf();
    }

    function generateTrademarkPdf() {
      if (!result.applicant.name) { if (window.__showToast) window.__showToast('请填写申请人信息', 'error'); return; }
      if (!result.fields.trademarkName) { if (window.__showToast) window.__showToast('请填写商标名称', 'error'); return; }
      if (!result.fields.goods) { if (window.__showToast) window.__showToast('请选择商标分类/填写商品项目', 'error'); return; }
      if (!result.categories.length) { if (window.__showToast) window.__showToast('请至少选择一个商标分类', 'error'); return; }

      const categoryList = result.categories.slice().sort((a, b) => a - b);
      const project = {
        name: result.fields.trademarkName,
        data: {
          markType: result.fields.trademarkType,
          category: categoryList.map(String).join('、'),
          categories: categoryList,
          goods: result.fields.goods,
          desc: result.fields.description,
          markImage: inputs.imagePreview
        }
      };
      try {
        const doc = PdfGenerator.generateTrademarkApplication(project, result.applicant);
        PdfGenerator.savePdf(doc, '商标申请书-' + result.fields.trademarkName + '-' + categoryList.join('-') + '-' + Date.now() + '.pdf');
        if (window.__showToast) window.__showToast('商标申请书 PDF 已生成（' + categoryList.length + ' 类）', 'success');
      } catch (e) {
        if (window.__showToast) window.__showToast('生成失败：' + e.message, 'error');
      }
    }

    function generateSoftwarePdf() {
      if (!result.applicant.name) { if (window.__showToast) window.__showToast('请填写申请人信息', 'error'); return; }
      if (!result.fields.softwareName) { if (window.__showToast) window.__showToast('请填写软件全称', 'error'); return; }

      const project = {
        name: result.fields.softwareName,
        data: {
          abbr: result.fields.abbreviation,
          version: result.fields.version,
          completionDate: result.fields.completionDate,
          publishDate: result.fields.firstPublishDate,
          publishStatus: result.fields.publishStatus,
          lang: result.fields.language,
          lines: result.fields.totalLines,
          features: result.fields.features,
          rightWay: result.fields.rightWay,
          handleWay: result.fields.handleWay,
          sourceCodeText: inputs.sourceFiles.map(f => f.text).join('\n\n'),
          sourceCodeSettings: { linesPerPage: 50, frontPages: 30, backPages: 30 }
        }
      };
      try {
        const doc1 = PdfGenerator.generateSoftwareApplication(project, result.applicant);
        PdfGenerator.savePdf(doc1, '软著申请表-' + result.fields.softwareName + '-' + Date.now() + '.pdf');
        if (inputs.sourceFiles.length > 0) {
          const doc2 = PdfGenerator.generateSourceCodeDocument(project, result.applicant);
          PdfGenerator.savePdf(doc2, '源程序-' + result.fields.softwareName + '-' + Date.now() + '.pdf');
        }
        if (window.__showToast) window.__showToast('PDF 已生成', 'success');
      } catch (e) {
        if (window.__showToast) window.__showToast('生成失败：' + e.message, 'error');
      }
    }

    // ===== 字段渲染函数 =====
    function renderTrademarkFields(h) {
      const typeSpecMap = {
        '文字': '不需要图样。仅填写商标名称即可。',
        '图形': '⚠️ 必须上传图样。JPG/PNG，5×5cm ~ 10×10cm。',
        '字母': '不需要图样。仅填写字母组合。',
        '数字': '不需要图样。仅填写数字。',
        '三维': '⚠️ 需要多角度图（6 面）。',
        '组合': '⚠️ 必须上传图样（图+文组合）。'
      };
      const currentType = result.fields.trademarkType || '文字';
      const needsImage = ['图形', '三维', '组合'].includes(currentType);

      function toggleCategory(n) {
        const idx = result.categories.indexOf(n);
        if (idx > -1) result.categories.splice(idx, 1);
        else result.categories.push(n);
        syncGoodsText();
      }

      function toggleSubclass(catCode, groupCode, item) {
        const key = catCode + '::' + groupCode + '::' + item;
        if (result.selectedSubclasses[key]) delete result.selectedSubclasses[key];
        else result.selectedSubclasses[key] = true;
        syncGoodsText();
      }

      function syncGoodsText() {
        const grouped = {};
        Object.keys(result.selectedSubclasses).forEach(k => {
          if (!result.selectedSubclasses[k]) return;
          const [catCode, groupCode, ...rest] = k.split('::');
          const item = rest.join('::');
          if (!grouped[catCode]) grouped[catCode] = [];
          grouped[catCode].push(item);
        });
        result.fields.goods = Object.entries(grouped)
          .map(([code, items]) => '[' + code + '] ' + items.join('；'))
          .join('\n');
      }

      const classNames = {
        1:'化学原料',2:'颜料油漆',3:'日化用品',4:'工业油脂',5:'医药用品',
        6:'金属材料',7:'机械设备',8:'手工器械',9:'科学仪器',10:'医疗器械',
        11:'灯具空调',12:'运输工具',13:'军火烟火',14:'珠宝钟表',15:'乐器',
        16:'办公用品',17:'橡胶制品',18:'皮革皮具',19:'建筑材料',20:'家具用品',
        21:'厨房洁具',22:'绳网篷帐',23:'纺织纱线',24:'布料床品',25:'服装鞋帽',
        26:'饰品配件',27:'地毯席垫',28:'玩具用品',29:'食品罐头',30:'茶糖糕点',
        31:'农林产品',32:'啤酒饮料',33:'酒类饮品',34:'烟草烟具',35:'广告商业',
        36:'金融保险',37:'建筑修理',38:'通讯服务',39:'运输配送',40:'加工服务',
        41:'教育娱乐',42:'科技服务',43:'餐饮住宿',44:'医疗美容',45:'安法服务'
      };

      function renderSelectedCategory(catNum) {
        const cls = NiceClasses.getClass(catNum);
        const subclasses = NiceClasses.getSubclasses(catNum);
        const catCode = String(catNum).padStart(2, '0');
        return h('div', { class: 'cat-detail', key: catNum }, [
          h('div', { class: 'row between', style: 'margin-bottom:8px' }, [
            h('strong', null, [
              '第 ' + catNum + ' 类 · ',
              h('span', { class: 'tag tag-primary' }, cls ? cls.name : ''),
              h('span', { class: 'muted', style: 'margin-left:8px;font-size:12px' }, cls ? cls.desc : '')
            ]),
            h('button', { class: 'btn-ghost', onClick: () => toggleCategory(catNum) }, '✕ 移除')
          ]),
          subclasses.length > 0 ? h('div', null, [
            h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, '类似群组（点击勾选）'),
            ...subclasses.map(g => h('div', { class: 'subclass-block', key: g.code }, [
              h('div', { class: 'subclass-title' }, '【' + g.code + '】 ' + g.title),
              h('div', { class: 'subclass-items' },
                g.items.map(item => h('label', { key: g.code + '-' + item }, [
                  h('input', {
                    type: 'checkbox',
                    checked: !!result.selectedSubclasses[catCode + '::' + g.code + '::' + item],
                    onChange: () => toggleSubclass(catCode, g.code, item)
                  }),
                  h('span', { style: 'margin-left:4px' }, item)
                ]))
              )
            ]))
          ]) : h('div', { class: 'muted', style: 'font-size:12px' }, '该类别暂无内置群组，请手动填写商品')
        ]);
      }

      return [
        h('div', { class: 'result-card' }, [
          h('div', { class: 'row between' }, [
            h('div', { class: 'label' }, '商标名称'),
            h('button', { class: 'btn-ghost', onClick: () => generateIdeas() }, '💡 AI 起名 / 建议')
          ]),
          h('input', {
            value: result.fields.trademarkName || '',
            placeholder: '2-6 字简洁名称（或点右上 AI 起名）',
            onInput: (e) => { result.fields.trademarkName = e.target.value; }
          })
        ]),
        h('div', { class: 'result-card' }, [
          h('div', { class: 'label' }, '商标类型'),
          h('select', {
            value: currentType,
            onChange: (e) => { result.fields.trademarkType = e.target.value; }
          }, ['文字', '图形', '字母', '数字', '三维', '组合'].map(t => h('option', { value: t }, t))),
          h('div', {
            class: 'muted',
            style: 'margin-top:8px;padding:8px 12px;background:' + (needsImage ? '#fef3c7' : '#f0fdf4') + ';border-radius:4px;font-size:12px'
          }, typeSpecMap[currentType] || '')
        ]),
        needsImage ? h('div', { class: 'result-card' }, [
          h('div', { class: 'label' }, '📷 商标图样'),
          h('div', {
            class: 'dropzone' + (inputs.imagePreview ? ' preview' : ''),
            style: 'padding:16px',
            onClick: () => { var el = document.getElementById('img-input'); if (el) el.click(); },
            onDragover: (e) => { e.preventDefault(); },
            onDrop: (e) => { e.preventDefault(); handleImageDrop(e); }
          }, inputs.imagePreview ? [
            h('img', { src: inputs.imagePreview, style: 'max-width:200px;max-height:200px;display:block;margin:0 auto' }),
            h('div', { class: 'mt-8 muted', style: 'font-size:12px' },
              '像素: ' + (inputs.imageDims ? inputs.imageDims.w + ' × ' + inputs.imageDims.h : '?') +
              ' · 大小: ' + (inputs.imageBlob ? (inputs.imageBlob.size/1024).toFixed(1) + ' KB' : '?')
            ),
            h('div', { class: 'mt-8' }, [
              h('button', { class: 'btn-ghost', onClick: (e) => { e.stopPropagation(); inputs.imageBlob = null; inputs.imagePreview = null; inputs.imageDims = null; } }, '🗑️ 重新上传')
            ])
          ] : [
            h('div', { class: 'icon', style: 'font-size:24px' }, '📷'),
            h('p', { style: 'font-size:13px' }, '点击上传商标图样'),
            h('p', { class: 'hint' }, '5×5cm~10×10cm，@300 DPI = 591~1181 像素')
          ])
        ]) : null,
        h('div', { class: 'result-card' }, [
          h('div', { class: 'row between' }, [
            h('div', { class: 'label' }, '商标分类（Nice 1-45，可多选）'),
            h('span', { class: 'muted', style: 'font-size:12px' }, '已选 ' + result.categories.length + ' 类')
          ]),
          result.categories.length > 0 ? h('div', { class: 'selected-cats mt-8' },
            result.categories.sort((a, b) => a - b).map(c => h('span', {
              class: 'cat-chip', key: c, onClick: () => toggleCategory(c)
            }, [c + '类', h('span', { class: 'cat-chip-rm' }, '✕')]))
          ) : h('div', { class: 'muted mt-8', style: 'font-size:12px' }, '请从下方网格中选择类别'),
          h('div', { class: 'class-grid mt-12' },
            Array.from({length: 45}, (_, i) => i + 1).map(n => h('div', {
              class: 'class-cell' + (result.categories.includes(n) ? ' selected' : ''),
              key: n, onClick: () => toggleCategory(n)
            }, [
              h('div', { class: 'class-num' }, String(n)),
              h('div', { class: 'class-name' }, classNames[n] || '')
            ]))
          )
        ]),
        result.categories.length > 0 ? h('div', { class: 'result-card' }, [
          h('div', { class: 'label' }, '商品/服务（点击下方类似群组自动汇总）'),
          ...result.categories.sort((a, b) => a - b).map(c => renderSelectedCategory(c)),
          h('div', { class: 'mt-12' }, [
            h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:4px' }, '汇总：'),
            h('textarea', {
              value: result.fields.goods || '',
              placeholder: '[0901] 计算机；计算机硬件；\n[4220] 软件设计；软件升级',
              rows: 5,
              onInput: (e) => { result.fields.goods = e.target.value; }
            })
          ])
        ]) : null,
        h('div', { class: 'result-card' }, [
          h('div', { class: 'label' }, '商标含义 / 描述'),
          h('textarea', {
            value: result.fields.description || '',
            placeholder: '商标设计含义、用途等',
            rows: 2,
            onInput: (e) => { result.fields.description = e.target.value; }
          })
        ])
      ];
    }

    function renderSoftwareFields(h) {
      return [
        h('div', { class: 'result-card' }, [
          h('div', { class: 'label' }, '软件全称'),
          h('input', {
            value: result.fields.softwareName || '',
            placeholder: '智产管家商标与软著申请管理系统 V1.0',
            onInput: (e) => { result.fields.softwareName = e.target.value; }
          })
        ]),
        h('div', { class: 'field-row' }, [
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '简称'),
            h('input', { value: result.fields.abbreviation || '', onInput: (e) => { result.fields.abbreviation = e.target.value; } })
          ]),
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '版本号'),
            h('input', { value: result.fields.version || '1.0.0', onInput: (e) => { result.fields.version = e.target.value; } })
          ])
        ]),
        h('div', { class: 'field-row' }, [
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '开发完成日期'),
            h('input', { type: 'date', value: result.fields.completionDate || '', onInput: (e) => { result.fields.completionDate = e.target.value; } })
          ]),
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '发表状态'),
            h('select', { value: result.fields.publishStatus || '未发表', onChange: (e) => { result.fields.publishStatus = e.target.value; } },
              ['未发表', '已发表'].map(s => h('option', { value: s }, s)))
          ])
        ]),
        h('div', { class: 'field-row' }, [
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '开发语言'),
            h('input', { value: result.fields.language || '', placeholder: 'Python / JavaScript / Java', onInput: (e) => { result.fields.language = e.target.value; } })
          ]),
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '代码行数'),
            h('input', { type: 'number', value: result.fields.totalLines || inputs.sourceTotalLines || 0, onInput: (e) => { result.fields.totalLines = parseInt(e.target.value, 10) || 0; } })
          ])
        ]),
        h('div', { class: 'result-card' }, [
          h('div', { class: 'label' }, '技术特点 / 主要功能'),
          h('textarea', {
            value: result.fields.features || '',
            rows: 5,
            placeholder: '150-300 字',
            onInput: (e) => { result.fields.features = e.target.value; }
          })
        ]),
        h('div', { class: 'field-row' }, [
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '权利取得方式'),
            h('select', { value: result.fields.rightWay || '原始', onChange: (e) => { result.fields.rightWay = e.target.value; } },
              ['原始', '继承', '受让'].map(s => h('option', { value: s }, s)))
          ]),
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '办理方式'),
            h('select', { value: result.fields.handleWay || '自办', onChange: (e) => { result.fields.handleWay = e.target.value; } },
              ['自办', '代理'].map(s => h('option', { value: s }, s)))
          ])
        ])
      ];
    }

    // ===== 初始化 =====
    onMounted(() => {
      loadSettings();
      const ph = document.getElementById('loading-placeholder');
      if (ph) ph.style.display = 'none';
    });

    return {
      mode, activeTab, loading, loadingMsg, progress,
      inputs, result, settings, showSettings, showSubmitHelp,
      showIdeaPanel, ideaParams, ideaResults,
      // 高新认定模块状态 — 必须在 setup 里声明 ref 才能触发响应式
      htMainTab: ref('assess'),
      highTechAnswers: reactive({}),
      highTechScore: null,
      highTechReviewDate: ref(''),
      aiImage: reactive({ show: false, name: '', results: [], generating: false, picked: null }),
      // 研发台账子 tab 状态
      htSubTab: ref('overview'),
      htOverview: reactive({ year: new Date().getFullYear(), data: null, loading: false, loaded: false }),
      htProjects: reactive({ list: [], loading: false, loaded: false, editing: null }),
      htExpenses: reactive({ list: [], projects: [], loading: false, loaded: false, editing: null, filterProject: 'all', filterYear: 'all' }),
      htStaff: reactive({ list: [], loading: false, loaded: false, editing: null }),
      htIncome: reactive({ list: [], loading: false, loaded: false, editing: null, totalIncome: 0 }),
      htExportYear: ref(new Date().getFullYear()),
      saveSettings, handleImageUpload, handleImageDrop, runOcr,
      fetchGithubData, handleSourceFolder, removeSourceFile, clearAll,
      runAiExtract, suggestCategoryFallback, generatePdf,
      renderTrademarkFields, renderSoftwareFields,
      generateIdeas, fetchIdeas, pickIdea
    };
  },

  render() {
    const h = Vue.h;
    const self = this;
    const field = (label, input, opts) => h('div', { class: 'field' + (opts && opts.full ? ' full' : '') }, [
      h('label', null, label), input
    ]);
    const btn = (text, onClick, opts) => h('button', {
      class: (opts && opts.primary ? 'btn-primary' : 'btn') + (opts && opts.big ? ' btn-big' : ''),
      onClick: onClick, disabled: opts && opts.disabled
    }, text);
    const tab = (key, label) => h('button', {
      class: 'tab' + (self.activeTab === key ? ' active' : ''),
      onClick: () => { self.activeTab = key; }
    }, label);

    const topbar = h('header', { class: 'topbar' }, [
      h('div', { class: 'topbar-inner' }, [
        h('div', { class: 'brand' }, [
          h('span', { class: 'brand-mark' }, 'IP'),
          h('span', { class: 'brand-name' }, '知产管家'),
          h('span', { class: 'brand-tag' }, 'v0.7')
        ]),
        h('div', { class: 'spacer' }),
        h('div', {
          class: 'api-status' + (self.settings.apiKey ? ' has-key' : ''),
          onClick: () => { self.showSettings = true; }
        }, [
          h('span', { class: 'dot' }),
          h('span', { class: 'label' }, self.settings.apiKey ? 'API 已配置' : '点击配置 API')
        ])
      ])
    ]);

    const modeSwitch = h('div', { class: 'mode-switch' }, [
      h('button', { class: 'mode-btn' + (self.mode === 'trademark' ? ' active' : ''), onClick: () => { self.mode = 'trademark'; } }, '📋 商标申请'),
      h('button', { class: 'mode-btn' + (self.mode === 'software' ? ' active' : ''), onClick: () => { self.mode = 'software'; } }, '💻 软著申请'),
      h('button', { class: 'mode-btn' + (self.mode === 'hightech' ? ' active' : '') , onClick: () => { self.mode = 'hightech'; } }, '🏆 高新认定')
    ]);

    const inputCard = h('div', { class: 'card' }, [
      h('h3', null, self.mode === 'trademark' ? '📋 商标信息采集' : '💻 软件信息采集'),
      h('p', { class: 'sub' }, self.mode === 'trademark'
        ? '上传商标图样 + 描述使用范围，AI 自动推荐 Nice 分类 + 申请书'
        : '上传营业执照 + GitHub 仓库 / 源码文件夹，AI 自动提取申请字段'),
      h('div', { class: 'tabs' }, [
        tab('image', '📷 营业执照/图样'),
        tab('github', '🔗 GitHub 仓库'),
        tab('source', '📁 源码文件夹'),
        tab('text', '✍️ 自由文字')
      ]),
      self.activeTab === 'image' ? h('div', null, [
        h('div', {
          class: 'dropzone' + (self.inputs.imagePreview ? ' preview' : ''),
          onClick: () => { var el = document.getElementById('img-input'); if (el) el.click(); },
          onDragover: (e) => { e.preventDefault(); },
          onDrop: (e) => { e.preventDefault(); self.handleImageDrop(e); }
        }, self.inputs.imagePreview ? [
          h('img', { src: self.inputs.imagePreview }),
          h('div', { class: 'mt-8' }, [
            h('button', { class: 'btn-ghost', onClick: (e) => { e.stopPropagation(); self.inputs.imageBlob = null; self.inputs.imagePreview = null; self.inputs.imageOcrText = ''; self.inputs.imageDims = null; } }, '🗑️ 重新选择')
          ])
        ] : [
          h('div', { class: 'icon' }, '📷'),
          h('p', null, self.mode === 'trademark' ? '点击/拖拽 商标图样到这里' : '点击/拖拽 营业执照图片到这里'),
          h('p', { class: 'hint' }, '支持 JPG/PNG，浏览器内 OCR 自动识别')
        ]),
        h('input', { type: 'file', accept: 'image/*', id: 'img-input', style: 'display:none', onChange: (e) => self.handleImageUpload(e) }),
        // —— 商标模式专属:AI 生成商标图样 ——
        (self.mode === 'trademark' && window.AITrademarkImage)
          ? window.AITrademarkImage.renderAITrademarkPanel(self, h)
          : null,
        self.inputs.imagePreview ? h('div', { class: 'mt-12' }, [
          btn('🔍 识别图样/营业执照', () => self.runOcr(), { primary: true }),
          self.inputs.imageOcrText ? h('div', { class: 'mt-12 result-card' }, [
            h('div', { class: 'label' }, 'OCR 识别结果'),
            h('div', { class: 'value', style: 'max-height:200px;overflow:auto;font-size:12px;white-space:pre-wrap' }, self.inputs.imageOcrText)
          ]) : null
        ]) : null
      ]) : null,
      self.activeTab === 'github' ? h('div', null, [
        field('GitHub 仓库 URL', h('input', {
          type: 'text', value: self.inputs.githubUrl,
          placeholder: 'https://github.com/owner/repo',
          onInput: (e) => { self.inputs.githubUrl = e.target.value; }
        })),
        h('div', { class: 'mt-8' }, [btn('🔍 抓取仓库信息', () => self.fetchGithubData(), { primary: true })]),
        self.inputs.githubData ? h('div', { class: 'mt-12' }, [
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '仓库'),
            h('div', { class: 'value' }, [
              h('strong', null, self.inputs.githubData.fullName),
              h('span', { class: 'tag tag-primary', style: 'margin-left:8px' }, '⭐ ' + self.inputs.githubData.stars),
              h('span', { class: 'tag', style: 'margin-left:4px' }, '🍴 ' + self.inputs.githubData.forks)
            ])
          ]),
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '描述'),
            h('div', { class: 'value' }, self.inputs.githubData.description || '（无）')
          ]),
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '主语言 / License'),
            h('div', { class: 'value' }, [
              h('span', { class: 'tag tag-primary' }, self.inputs.githubData.language || '未知'),
              h('span', { class: 'tag', style: 'margin-left:4px' }, self.inputs.githubData.license || '无 License')
            ])
          ])
        ]) : null
      ]) : null,
      self.activeTab === 'source' ? h('div', null, [
        h('div', {
          class: 'dropzone',
          onClick: () => { var el = document.getElementById('src-input'); if (el) el.click(); }
        }, [
          h('div', { class: 'icon' }, '📁'),
          h('p', null, '选择源码文件夹'),
          h('p', { class: 'hint' }, '支持 .py .js .ts .java .cpp .go 等')
        ]),
        h('input', { type: 'file', id: 'src-input', webkitdirectory: true, directory: true, multiple: true, style: 'display:none', onChange: (e) => self.handleSourceFolder(e) }),
        self.inputs.sourceFiles.length > 0 ? h('div', null, [
          h('div', { class: 'result-card' }, [
            h('div', { class: 'label' }, '读取结果'),
            h('div', { class: 'value' }, [
              h('strong', null, self.inputs.sourceFiles.length + ' 个文件'),
              ' · ',
              h('strong', null, self.inputs.sourceTotalLines + ' 行'),
              ' · 约 ',
              h('strong', null, Math.ceil(self.inputs.sourceTotalLines / 50) + ' 页')
            ])
          ]),
          h('div', { class: 'file-list' },
            self.inputs.sourceFiles.slice(0, 50).map((f, i) => h('div', { class: 'file-item', key: i }, [
              h('span', null, '📄 ' + f.name + ' (' + f.lines + ' 行)'),
              h('button', { onClick: () => self.removeSourceFile(i) }, '移除')
            ]))
          )
        ]) : null
      ]) : null,
      self.activeTab === 'text' ? h('div', null, [
        field('把任何相关文字粘进来', h('textarea', {
          value: self.inputs.freeText, class: 'big',
          placeholder: '例如：这是我们的核心产品 "智产管家"，是一款商标和软著申请管理工具...',
          onInput: (e) => { self.inputs.freeText = e.target.value; }
        }), { full: true })
      ]) : null,
      h('div', { class: 'mt-24 row gap-12 wrap' }, [
        btn('🤖 AI 智能提取', () => self.runAiExtract(), { primary: true, big: true }),
        self.mode === 'trademark' ? btn('💡 无 API 也推荐分类', () => self.suggestCategoryFallback()) : null,
        h('div', { class: 'spacer' }),
        btn('🗑️ 清空', () => self.clearAll())
      ]),
      self.loading ? h('div', { class: 'mt-12' }, [
        h('div', { class: 'muted' }, self.loadingMsg),
        h('div', { class: 'progress' }, [
          h('div', { class: 'progress-bar', style: 'width:' + self.progress + '%' })
        ])
      ]) : null
    ]);

    const applicantCard = h('div', { class: 'card' }, [
      h('h3', null, '👤 申请人 / 著作权人'),
      h('p', { class: 'sub' }, 'OCR 识别后自动填入，可手动调整'),
      h('div', { class: 'field-row' }, [
        field('类型', h('select', {
          value: self.result.applicant.type,
          onChange: (e) => { self.result.applicant.type = e.target.value; }
        }, [
          h('option', { value: 'company' }, '企业'),
          h('option', { value: 'individual' }, '个人')
        ])),
        field('名称', h('input', {
          value: self.result.applicant.name,
          placeholder: '公司名或个人姓名',
          onInput: (e) => { self.result.applicant.name = e.target.value; }
        })),
        field('统一社会信用代码/身份证号', h('input', {
          value: self.result.applicant.creditCode,
          placeholder: '企业 18 位 / 个人身份证',
          onInput: (e) => { self.result.applicant.creditCode = e.target.value; }
        })),
        field('法定代表人', h('input', {
          value: self.result.applicant.legalRep,
          placeholder: '营业执照上的法人',
          onInput: (e) => { self.result.applicant.legalRep = e.target.value; }
        })),
        field('联系电话', h('input', {
          value: self.result.applicant.phone,
          placeholder: '11 位手机号',
          onInput: (e) => { self.result.applicant.phone = e.target.value; }
        })),
        field('电子邮箱', h('input', {
          value: self.result.applicant.email,
          placeholder: '选填',
          onInput: (e) => { self.result.applicant.email = e.target.value; }
        })),
        field('通讯地址', h('input', {
          value: self.result.applicant.address,
          placeholder: '省市 + 街道 + 邮编',
          onInput: (e) => { self.result.applicant.address = e.target.value; }
        }), { full: true })
      ])
    ]);

    const fieldsCard = h('div', { class: 'card' }, [
      h('h3', null, self.mode === 'trademark' ? '📋 商标字段' : '💻 软著字段'),
      h('p', { class: 'sub' }, 'AI 提取后可手动调整'),
      ...(self.mode === 'trademark' ? self.renderTrademarkFields(h) : self.renderSoftwareFields(h))
    ]);

    const actionsCard = h('div', { class: 'card' }, [
      h('h3', null, '🚀 出 PDF + 提交指引'),
      h('p', { class: 'sub' }, '所有材料按官方要求生成。提交需要您本人的数字证书。'),
      h('div', { class: 'row gap-12 wrap' }, [
        btn('📄 生成 PDF 材料', () => self.generatePdf(), { primary: true, big: true }),
        btn('📝 查看提交步骤', () => { self.showSubmitHelp = true; })
      ])
    ]);

    const main = h('main', { class: 'main' }, [
      modeSwitch,
      self.mode === 'hightech'
        ? (window.HighTech ? window.HighTech.renderHighTechTab(self, h) : h('div', { class: 'card' }, [h('p', null, '高新模块加载中...')]))
        : h('div', { class: 'workbench' }, [
            inputCard,
            h('div', null, [applicantCard, fieldsCard, actionsCard])
          ])
    ]);

    const settingsModal = self.showSettings ? h('div', {
      class: 'modal-bg',
      onClick: (e) => { if (e.target.classList.contains('modal-bg')) self.showSettings = false; }
    }, [
      h('div', { class: 'modal' }, [
        h('h2', null, '⚙️ API 配置'),
        h('p', { class: 'muted' }, '支持 OpenAI / DeepSeek / 通义千问 / GLM 等。Key 仅存浏览器本地。'),
        field('API Base URL', h('input', { value: self.settings.baseUrl, placeholder: 'https://api.openai.com/v1', onInput: (e) => { self.settings.baseUrl = e.target.value; } })),
        field('API Key', h('input', { value: self.settings.apiKey, type: 'password', placeholder: 'sk-...', onInput: (e) => { self.settings.apiKey = e.target.value; } })),
        field('模型', h('input', { value: self.settings.model, placeholder: 'gpt-4o-mini / deepseek-chat', onInput: (e) => { self.settings.model = e.target.value; } })),
        field('GitHub Token（可选）', h('input', { value: self.settings.githubToken, type: 'password', placeholder: 'ghp_...', onInput: (e) => { self.settings.githubToken = e.target.value; } })),
        h('div', { class: 'actions' }, [
          btn('取消', () => { self.showSettings = false; }),
          btn('保存', () => self.saveSettings(), { primary: true })
        ])
      ])
    ]) : null;

    const submitHelp = self.showSubmitHelp ? h('div', {
      class: 'modal-bg',
      onClick: (e) => { if (e.target.classList.contains('modal-bg')) self.showSubmitHelp = false; }
    }, [
      h('div', { class: 'modal' }, [
        h('h2', null, '📝 ' + (self.mode === 'trademark' ? '商标局' : '版权中心') + ' 提交步骤'),
        self.mode === 'trademark' ? h('div', null, [
          h('p', null, '商标局系统：' + h('a', { href: 'https://sbj.cnipa.gov.cn/sbj', target: '_blank' }, 'sbj.cnipa.gov.cn/sbj')),
          h('ol', { class: 'steps' }, [
            h('li', null, [h('b', null, '注册账号'), '：手机/邮箱注册']),
            h('li', null, [h('b', null, '申请数字证书'), '：CA 证书']),
            h('li', null, [h('b', null, '进入"商标注册申请"')]),
            h('li', null, [h('b', null, '填写申请书'), '：对照工具生成的 PDF 字段复制']),
            h('li', null, [h('b', null, '上传商标图样')]),
            h('li', null, [h('b', null, '选类别/商品'), '：工具已按 45 类推荐+汇总']),
            h('li', null, [h('b', null, '缴费'), '：¥270/类（10 项以内）']),
            h('li', null, [h('b', null, '用数字证书签名提交')])
          ])
        ]) : h('div', null, [
          h('p', null, '版权保护中心：' + h('a', { href: 'https://www.ccopyright.com', target: '_blank' }, 'ccopyright.com')),
          h('ol', { class: 'steps' }, [
            h('li', null, [h('b', null, '注册账号'), '：身份证实名']),
            h('li', null, [h('b', null, '在线填报')]),
            h('li', null, [h('b', null, '上传材料'), '：申请表+源程序+说明书+身份证']),
            h('li', null, [h('b', null, '缴费'), '：个人 ¥100/企业 ¥250']),
            h('li', null, [h('b', null, '等待 30-60 工作日')])
          ])
        ]),
        h('div', { class: 'actions' }, [
          btn('关闭', () => { self.showSubmitHelp = false; }, { primary: true })
        ])
      ])
    ]) : null;

    const ideaPanel = self.showIdeaPanel ? h('div', {
      class: 'modal-bg',
      onClick: (e) => { if (e.target.classList.contains('modal-bg')) self.showIdeaPanel = false; }
    }, [
      h('div', { class: 'modal', style: 'width:720px;max-height:90vh;overflow:auto' }, [
        h('h2', null, '💡 AI 起名 / 商标创意'),
        h('p', { class: 'muted', style: 'font-size:13px' }, '基于产品描述，AI 生成 8 个商标候选（中/英/谐音/缩写）。点候选名字一键采用。'),
        h('div', { class: 'field-row' }, [
          field('产品/服务描述', h('textarea', {
            value: self.ideaParams.product,
            placeholder: '例如：商标和软著申请一站式管理工具，面向中小企业',
            onInput: (e) => { self.ideaParams.product = e.target.value; },
            rows: 2
          }), { full: true }),
          field('行业', h('input', { type: 'text', value: self.ideaParams.industry, placeholder: '科技服务', onInput: (e) => { self.ideaParams.industry = e.target.value; } })),
          field('目标客户', h('input', { type: 'text', value: self.ideaParams.target, placeholder: '中小企业', onInput: (e) => { self.ideaParams.target = e.target.value; } })),
          field('品牌调性', h('input', { type: 'text', value: self.ideaParams.tone, placeholder: '专业简洁 / 年轻活力', onInput: (e) => { self.ideaParams.tone = e.target.value; } })),
          field('已用名', h('input', { type: 'text', value: self.ideaParams.existing, placeholder: '避免与这些名近似', onInput: (e) => { self.ideaParams.existing = e.target.value; } })),
          field('方向', h('input', { type: 'text', value: self.ideaParams.direction, placeholder: '中文/英文/谐音/任意', onInput: (e) => { self.ideaParams.direction = e.target.value; } }))
        ]),
        h('div', { class: 'mt-12 row gap-12' }, [
          btn('🤖 生成候选商标', () => self.fetchIdeas(), { primary: true }),
          self.loading ? h('span', { class: 'muted', style: 'font-size:13px' }, self.loadingMsg) : null
        ]),
        self.ideaResults && self.ideaResults.ideas ? h('div', { class: 'mt-16' }, [
          h('div', { class: 'muted mb-8', style: 'font-size:13px;padding:8px 12px;background:#f0fdf4;border-radius:4px' },
            '💡 命名策略：' + (self.ideaResults.rationale || '')
          ),
          h('div', { class: 'idea-grid' },
            self.ideaResults.ideas.map((idea, i) => h('div', {
              class: 'idea-card', key: i, onClick: () => self.pickIdea(idea)
            }, [
              h('div', { class: 'idea-name' }, idea.name),
              h('div', { class: 'idea-meta' }, [
                h('span', { class: 'tag tag-primary' }, idea.type || ''),
                h('span', { class: 'tag', style: 'background:#d1fae5;color:#065f46;margin-left:4px' }, '可注册 ' + (idea.register_score || 0))
              ]),
              h('div', { class: 'idea-meaning' }, idea.meaning || ''),
              h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, idea.suitable_for || ''),
              h('div', { class: 'idea-cta' }, '👆 点击采用')
            ]))
          )
        ]) : null,
        h('div', { class: 'actions' }, [
          btn('关闭', () => { self.showIdeaPanel = false; })
        ])
      ])
    ]) : null;

    return h('div', null, [topbar, main, settingsModal, submitHelp, ideaPanel]);
  }
});

app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue Error]', err, info);
  if (window.__showError) window.__showError('vue', err);
};

window.__showToast = function(msg, type, duration) {
  let box = document.getElementById('__toast_box__');
  if (!box) {
    box = document.createElement('div');
    box.id = '__toast_box__';
    document.body.appendChild(box);
  }
  const div = document.createElement('div');
  div.className = 'toast toast-' + (type || 'success');
  div.textContent = msg;
  box.appendChild(div);
  setTimeout(() => { div.remove(); }, duration || 3000);
};

try {
  app.mount('#app');
  const ph = document.getElementById('loading-placeholder');
  if (ph) ph.style.display = 'none';
  console.log('[ip-butler] mounted v0.7');
} catch (e) {
  if (window.__showError) window.__showError('mount', e);
  console.error('[ip-butler] mount error', e);
}