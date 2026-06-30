/**
 * 知产管家 - PDF 生成器
 * 用 jsPDF 生成符合商标局 / 版权中心格式的 PDF
 */
const PdfGenerator = (() => {
  const { jsPDF } = window.jspdf;
  const autoTable = window.jspdfAutotable || window['jspdf-autotable'];

  function checkMarkImageDataUrl() {
    return window._currentMarkImage || null;
  }
  function setMarkImage(dataUrl) {
    window._currentMarkImage = dataUrl;
  }
  function clearMarkImage() {
    window._currentMarkImage = null;
  }

  // ====== 1. 商标申请书 ======
  function generateTrademarkApplication(project, applicant) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('商标注册申请书', 105, 25, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Application for Trademark Registration', 105, 32, { align: 'center' });
    doc.setTextColor(0);

    let y = 50;
    const leftX = 25;
    const labelW = 30;
    const valueX = leftX + labelW;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('一、申请人信息', leftX, y);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    function row(label, value) {
      doc.setFont('helvetica', 'bold');
      doc.text(label, leftX, y);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(String(value || '-'), 130);
      doc.text(lines, valueX, y);
      y += Math.max(6, lines.length * 5);
    }

    const apTypeLabel = applicant.type === 'individual' ? '个人' : '企业';
    row('申请人类型：', apTypeLabel);
    row('申请人名称：', applicant.name);
    row('证件号码：', applicant.idNumber);
    row('联系电话：', applicant.phone);
    if (applicant.email) row('电子邮箱：', applicant.email);
    row('通讯地址：', applicant.address);

    y += 6;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('二、商标信息', leftX, y);
    y += 8;
    doc.setFontSize(10);

    const data = project.data || {};
    row('商标名称：', project.name);
    const typeMap = {
      '文字': '文字商标', '图形': '图形商标', '字母': '字母商标',
      '数字': '数字商标', '三维': '三维标志商标', '组合': '图文组合商标'
    };
    row('商标类型：', typeMap[data.markType] || data.markType || '-');
    row('商标图样：', '另附（5 份，长和宽不超 10cm×10cm，不少于 5cm×5cm）');

    const img = checkMarkImageDataUrl();
    if (img && (data.markType === '图形' || data.markType === '组合')) {
      try {
        doc.addImage(img, 'PNG', valueX, y - 4, 30, 30);
        y += 32;
      } catch (e) { console.warn('图样插入失败', e); }
    }

    y += 4;
    row('商标类别：', `第 ${data.category || '-'} 类（共 45 类，Nice 分类）`);

    if (data.goods && data.goods.trim()) {
      doc.setFont('helvetica', 'bold');
      doc.text('商品/服务项目：', leftX, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(data.goods.trim(), 160);
      doc.text(lines, leftX, y);
      y += lines.length * 5 + 4;
    }

    y += 4;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('三、申请声明', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const claims = [
      '☑ 基于真实使用意图申请',
      '☑ 商标图样清晰，申请类别准确'
    ];
    if (data.priorityClaim) claims.push('☑ 要求优先权');
    claims.forEach(c => { doc.text(c, leftX, y); y += 6; });

    y += 4;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('四、规费说明', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('商标局规费 ¥270/类（含 10 个商品/服务项），超出每项 ¥30。', leftX, y);
    y += 10;

    doc.setFontSize(10);
    doc.text('申请人签字 / 盖章：____________________', leftX, y);
    y += 10;
    doc.text('申请日期：____ 年 ____ 月 ____ 日', leftX, y);

    y = 270;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('本申请书由"知产管家"生成草稿。请以商标局网上系统提交信息为准。', 105, y, { align: 'center' });
    doc.text('商标局网上服务系统：sbj.cnipa.gov.cn/sbj', 105, y + 5, { align: 'center' });

    clearMarkImage();
    return doc;
  }

  // ====== 2. 软件著作权申请表 ======
  function generateSoftwareApplication(project, applicant) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('计算机软件著作权登记申请表', 105, 20, { align: 'center' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Application for Copyright Registration of Computer Software', 105, 27, { align: 'center' });

    let y = 42;
    const leftX = 20;
    const labelW = 38;
    const valueX = leftX + labelW;

    doc.setFontSize(10);

    function row(label, value, halfRow) {
      doc.setFont('helvetica', 'bold');
      doc.text(label, leftX, y);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(String(value || '-'), halfRow ? 65 : 130);
      doc.text(lines, valueX, y);
      if (!halfRow) y += Math.max(6, lines.length * 5);
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('软件基本信息', leftX, y);
    y += 8;

    const data = project.data || {};
    doc.setFontSize(10);
    row('软件全称：', project.name);
    row('软件简称：', data.abbr || '-', true);
    y -= 6;
    row('', '');
    row('版本号：', data.version ? 'V' + data.version : '-', true);
    row('开发完成日期：', data.completionDate || '-', true);
    y -= 6;
    row('首次发表日期：', data.publishDate || '未发表', true);
    row('发表状态：', data.publishStatus || '未发表', true);
    y -= 6;
    row('', '');
    row('开发语言：', data.lang || '-', true);
    row('代码行数：', data.lines ? data.lines + ' 行' : '-', true);
    y -= 6;
    row('', '');

    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.text('技术特点 / 用途：', leftX, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    const features = doc.splitTextToSize(data.features || '（软件说明）', 170);
    doc.text(features, leftX, y);
    y += features.length * 5 + 4;

    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('著作权人信息', leftX, y);
    y += 8;
    doc.setFontSize(10);
    row('著作权人类型：', applicant.type === 'individual' ? '个人' : '法人（企业）');
    row('姓名 / 名称：', applicant.name);
    row('证件号码：', applicant.idNumber);
    row('通讯地址：', applicant.address);
    row('联系电话：', applicant.phone);
    if (applicant.email) row('电子邮箱：', applicant.email);

    if (y > 230) { doc.addPage(); y = 20; }
    y += 4;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('权利取得方式', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const rightMark = data.rightWay === '继承' ? '○' : data.rightWay === '受让' ? '○' : '●';
    const transferMark = data.rightWay === '受让' ? '●' : '○';
    const inheritMark = data.rightWay === '继承' ? '●' : '○';
    doc.text(`${inheritMark} 继承  ${transferMark} 受让  ${rightMark} 原始`, leftX, y);
    y += 8;

    row('权利范围：', '● 全部权利   ○ 部分权利');

    if (y > 230) { doc.addPage(); y = 20; }
    y += 4;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('申请办理方式', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(data.handleWay === '代理' ? '○ 自办  ● 委托代理' : '● 自办  ○ 委托代理', leftX, y);
    y += 8;

    if (data.agentName) row('代理人姓名：', data.agentName);

    if (y > 200) { doc.addPage(); y = 20; }
    y += 4;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('提交材料核对清单', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const checks = [
      '☑ 软件著作权登记申请表（本表）',
      '☑ 软件源程序鉴别材料（前 30 页 + 后 30 页，每页 50 行，共 60 页）',
      '☑ 软件文档鉴别材料（说明书等，不少于 60 页 / 不少于 6 张）',
      '☑ 著作权人身份证明（个人身份证 / 企业营业执照副本）',
      '☑ 委托办理的，应提交代理人授权书'
    ];
    checks.forEach(c => { doc.text(c, leftX, y); y += 6; });

    y += 6;
    doc.setFontSize(9);
    const declaration = '本人（本单位）郑重声明：所填写内容及所附材料真实、合法。如有不实之处，愿承担相应法律责任。';
    const decl = doc.splitTextToSize(declaration, 170);
    doc.text(decl, leftX, y);
    y += decl.length * 5 + 10;

    doc.setFontSize(10);
    doc.text('申请人签字 / 盖章：______________________', leftX, y);
    y += 8;
    doc.text('申请日期：________ 年 ______ 月 ______ 日', leftX, y);

    y = 275;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('本申请表由"知产管家"生成草稿。请以版权保护中心系统提交信息为准。', 105, y, { align: 'center' });
    doc.text('中国版权保护中心：ccopyright.com', 105, y + 5, { align: 'center' });

    return doc;
  }

  // ====== 3. 源程序 60 页文档 ======
  function generateSourceCodeDocument(project, applicant) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const settings = project.data.sourceCodeSettings || { linesPerPage: 50, frontPages: 30, backPages: 30 };
    const fullText = project.data.sourceCodeText || '';

    const lines = fullText.split(/\r?\n/);
    const linesPerPage = settings.linesPerPage || 50;
    const totalPages = Math.ceil(lines.length / linesPerPage);
    const frontPagesCount = Math.min(settings.frontPages || 30, totalPages);
    const backPagesCount = Math.min(settings.backPages || 30, totalPages);

    const frontLineCount = frontPagesCount * linesPerPage;
    const frontLines = lines.slice(0, frontLineCount);
    const backStartIdx = Math.max(0, lines.length - backPagesCount * linesPerPage);
    const backLines = lines.slice(backStartIdx);

    let pageNumber = 1;

    drawCodeCover(doc, project, applicant, settings, lines);
    pageNumber++;

    addTextPages(doc, frontLines, pageNumber, '前 30 页', linesPerPage);
    pageNumber += Math.ceil(frontLines.length / linesPerPage);

    if (backStartIdx > frontLineCount) {
      doc.addPage();
      drawCodeSeparator(backStartIdx - frontLineCount);
      pageNumber++;
    }

    addTextPages(doc, backLines, pageNumber, '后 30 页', linesPerPage);
    return doc;
  }

  function drawCodeCover(doc, project, applicant, settings, lines) {
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('软件源程序鉴别材料', 105, 50, { align: 'center' });
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text('Software Source Code Dispositive Material', 105, 62, { align: 'center' });

    doc.setFontSize(12);
    let y = 100;
    doc.setFont('helvetica', 'bold');
    doc.text('软件全称：', 50, y);
    doc.setFont('helvetica', 'normal');
    doc.text(project.name, 95, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('版本号：', 50, y);
    doc.setFont('helvetica', 'normal');
    doc.text('V' + (project.data.version || '1.0'), 95, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('著作权人：', 50, y);
    doc.setFont('helvetica', 'normal');
    doc.text(applicant.name, 95, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('总行数：', 50, y);
    doc.setFont('helvetica', 'normal');
    doc.text(lines.length + ' 行', 95, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('每页行数：', 50, y);
    doc.setFont('helvetica', 'normal');
    doc.text((settings.linesPerPage || 50) + ' 行', 95, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('制取方式：', 50, y);
    doc.setFont('helvetica', 'normal');
    const totalPages = Math.ceil(lines.length / (settings.linesPerPage || 50));
    const frontPages = Math.min(settings.frontPages || 30, totalPages);
    const backPages = Math.min(settings.backPages || 30, totalPages);
    doc.text(`前 ${frontPages} 页 + 后 ${backPages} 页（跳过中间 ${Math.max(0, totalPages - frontPages - backPages)} 页）`, 95, y);
    y += 10;

    y = 220;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const declaration = `本程序是 ${project.name} 的完整、真实、准确的源代码，与提交登记的软件版本完全一致。`;
    const linesTxt = doc.splitTextToSize(declaration, 130);
    doc.text(linesTxt, 40, y);
    y = 260;
    doc.setFont('helvetica', 'bold');
    doc.text('著作权人签字 / 盖章：', 40, y);
    doc.text('________________________', 95, y);
    y += 12;
    doc.text('日期：', 40, y);
    doc.text('________ 年 ______ 月 ______ 日', 60, y);
  }

  function drawCodeSeparator(skippedLineCount) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150);
    doc.text('（此处跳过中间部分）', 105, 100, { align: 'center' });
    doc.setFontSize(11);
    doc.text(`共跳过 ${skippedLineCount} 行源代码`, 105, 115, { align: 'center' });
    doc.setTextColor(0);
  }

  function addTextPages(doc, lines, startPageNumber, sectionLabel, linesPerPage) {
    const usableHeight = 240;
    const lineHeight = usableHeight / linesPerPage;

    let i = 0;
    let pageNum = startPageNumber;

    doc.setFont('courier', 'normal');
    doc.setFontSize(9);

    while (i < lines.length) {
      doc.addPage();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`${sectionLabel} - 第 ${pageNum} 页`, 20, 12);
      doc.setTextColor(0);

      doc.setFont('courier', 'normal');
      doc.setFontSize(9);

      const pageLines = lines.slice(i, i + linesPerPage);
      let y = 20;
      pageLines.forEach((ln, idx) => {
        doc.setTextColor(150);
        doc.text(String(i + idx + 1).padStart(4, ' '), 20, y);
        doc.setTextColor(0);
        const truncated = ln.length > 90 ? ln.substring(0, 87) + '...' : ln;
        doc.text(truncated || ' ', 30, y);
        y += lineHeight;
      });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`- ${pageNum} -`, 105, 287, { align: 'center' });
      doc.setTextColor(0);

      i += linesPerPage;
      pageNum++;
    }
  }

  return {
    generateTrademarkApplication,
    generateSoftwareApplication,
    generateSourceCodeDocument,
    setMarkImage,
    savePdf(doc, filename) { doc.save(filename); },
    outputPdf(doc, filename) {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
})();
