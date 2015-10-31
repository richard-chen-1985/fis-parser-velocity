var Engine = require('velocity').Engine,
    path = require('path'),
    util = fis.util;

/**
 * fis-parser-velocity
 * @param content
 * @param file
 * @param settings
 * @returns {String} ������html����
 */
function VMParser(content, file, settings) {
    this.file = file;
    // �����ļ���ȡ
    this.opt = require('../config.js');
    util.merge(this.opt, settings);
    this.opt.template = content;
    this.opt.macro = this.getAbsolutePath(this.opt.macro, this.opt.root);
    this.opt.commonMock = this.getAbsolutePath(this.opt.commonMock, this.opt.root);

    // ���ر�����ʼ��
    this.vmFiles = [];
    this.jsFiles = [];
    this.jsBlocks = [];
    this.cssFiles = [];
    this.cssBlocks = [];
    this.mockFiles = [];
    this.framework = ''
}

VMParser.prototype = {
    constructor: VMParser,
    /**
     * ���ļ����ݽ�����Ⱦ
     */
    renderTpl: function() {
        var self = this,
            opt = this.opt,
            file = this.file,
            root = opt.root,
            context = {},
            result = opt.template;

        if (opt.template === '') {
            return '';
        }

        // �ռ�#script��#style����
        opt.template = this.compileStatic(opt.template);
        // ��ȡ#parse������ļ�
        opt.template = this.compileParse(opt.template);
        // ��ȡ����������context
        context = this.getContext();

        // �õ���������ļ�����
        result = opt.parse ? new Engine(opt).render(context) : opt.template;
        // �����������������
        result = this.addStatics(result);

        // ����������棬����ͬ������
        this.addDeps();

        return result;
    },
    /**
     * ��ȡ����������mock�ļ���������ҳ���������棬����ͬ������
     * @return
     *  [Object]
     */
    getContext: function() {
        var context = {},
            self = this,
            opt = this.opt,
            root = opt.root,
            arrFiles = [];

        // ���ȫ��mock��context
        if(opt.commonMock) {
            arrFiles.push(opt.commonMock);
        }

        // ��ҳ���ļ�ͬ��mock�ļ�����context
        var pageMock = this.getAbsolutePath(this.replaceExt(this.file.subpath, '.mock'), root);
        if(pageMock) {
            arrFiles.push(pageMock);
        }

        // ��#parse�����mock�ļ�����context
        arrFiles = arrFiles.concat(this.mockFiles);

        arrFiles.forEach(function(_file) {
            if(_file) {
                util.merge(context, require(_file));
                delete require.cache[_file];
            }
        });

        return context;
    },
    // ����������#parse������ļ����ռ�ͬ��css, js, mock�ļ�
    compileParse: function(content) {
        var self = this,
            opt = this.opt,
            root = opt.root,
            regParse = /(#?)#parse\(\s*('|")([^\)]+)\2\s*\)/g;

        content = content.replace(regParse, function(match, comment, qoute, uri) {
            if(comment !== '') {
                return match;
            }
            var file = self.getAbsolutePath(uri, root);
            var result = '';
            var _cssArr, _jsFile, _mockFile;
            if(file) {
                self.vmFiles.push(file);
                result = util.read(file);
                // �ռ�css�ļ�
                _cssArr = [
                    self.replaceExt(uri, '.scss'),
                    self.replaceExt(uri, '.less'),
                    self.replaceExt(uri, '.css')
                ];
                _cssArr.forEach(function(css) {
                    if(self.getAbsolutePath(css, root) && self.cssFiles.indexOf(css) === -1) {
                        self.cssFiles.push(css);
                    }
                });
                // �ռ�js�ļ�
                _jsFile = self.replaceExt(uri, '.js');
                if(self.getAbsolutePath(_jsFile, root) && self.jsFiles.indexOf(_jsFile) === -1) {
                    self.jsFiles.push(_jsFile);
                }
                // �ռ�mock�ļ�
                _mockFile = self.getAbsolutePath(self.replaceExt(uri, '.mock'), root);
                if(_mockFile && self.mockFiles.indexOf(_mockFile) === -1) {
                    self.mockFiles.push(_mockFile);
                }
                // �ռ�#script��#style����
                result = self.compileStatic(result);
                if(regParse.test(result)) {
                    result = self.compileParse(result);
                }
                // ����ģ�����ʱ�������ļ����ݣ����򱣳�ԭ��
                if(opt.parse) {
                    return result;
                } else {
                    return match;
                }
            } else {
                throw new Error('can not load:' + uri + ' [' + self.file.subpath + ']');
            }
        });
        return content;
    },
    /**
     * ������̬��Դ��ǩ#style, #framework, #script
     * @param content [String]
     * @return content [String] ��#style,#framework,#script�滻ΪΪ�գ�����ͳһ����������Դ
     */
    compileStatic: function(content) {
        var self = this,
            opt = this.opt,
            regCss = /\s*(#?)#style\(\s*('|")([^\)]+)\2\s*\)/g,
            regCssBlock = /(\s*#style\(\)([\s\S]*?)#endstyle)\n?/g,
            regFrameWork = /\s*(#?)#framework\(\s*('|")([^\)]+)\2\s*\)/g,
            regScript = /\s*(#?)#script\(\s*('|")([^\)]+)\2\s*\)/g,
            regScriptBlock = /(\s*#script\(\)([\s\S]*?)#endscript)\n?/g;

        // �滻#style
        content = content.replace(regCss, function(match, comment, qoute, uri) {
            if(comment !== '') {
                return match;
            }
            if(self.cssFiles.indexOf(uri) === -1) {
                self.cssFiles.push(uri);
            }
            return '';
        });
        // �滻#style()...#endstyle
        content = content.replace(regCssBlock, function(match, css, block) {
            self.cssBlocks.push(block);
            return '';
        });
        // �滻#framework
        content = content.replace(regFrameWork, function(match, comment, qoute, uri) {
            if(comment !== '') {
                return match;
            }
            self.framework = uri;
            return '';
        });
        // �滻#script
        content = content.replace(regScript, function(match, comment, qoute, uri) {
            if(comment !== '') {
                return match;
            }
            if(self.jsFiles.indexOf(uri) === -1) {
                self.jsFiles.push(uri);
                // ����ͬ��css�ļ�
                var arrCss = [
                    self.replaceExt(uri, '.css'),
                    self.replaceExt(uri, '.less'),
                    self.replaceExt(uri, '.sass')
                ];
                arrCss.forEach(function(css) {
                    if(self.getAbsolutePath(css, self.opt.root) && self.cssFiles.indexOf(css) === -1) {
                        self.cssFiles.push(css)
                    }
                });
            }
            return '';
        });
        // �滻#script() ... #endscript
        content = content.replace(regScriptBlock, function(match, script, block) {
            self.jsBlocks.push(block);
            return '';
        });
        return content;
    },
    /** �滻�ļ�����չ��
     * @example
     * replaceExt('/widget/a/a.html', '.css') => '/widget/a/a.css'
     */
    replaceExt: function(pathname, ext) {
        return pathname.substring(0, pathname.lastIndexOf('.')) + ext;
    },
    /**
     * �����ļ�����·������ΪrootΪ���飬����ÿ��root�����ж�һ��
     * @param file {String} �ļ����·��
     * @param root {Array} rootĿ¼����
     * @return {String} �����ļ�����·������null
     */
    getAbsolutePath: function(file, root) {
        var result = null;
        if(!file || !root || !util.isArray(root)) {
            return result;
        }
        for(var i = 0; i < root.length; i++) {
            if(util.exists(path.join(root[i], file))) {
                result = path.join(root[i], file);
                break;
            }
        }
        return result;
    },
    /**
     * ��Ӿ�̬��Դ����
     */
    addStatics: function(content) {
        var self = this,
            opt = this.opt,
            loader = opt.loader || null,// ģ�黯���غ�������[requirejs|modjs|seajs]
            loadSync = opt.loadSync,
            root = opt.root,
            strCss = '',
            strFrameWork = '',
            strJs = '',
            rCssHolder = /<!--\s?WIDGET_CSS_HOLDER\s?-->/,
            rFrameWorkHolder = /<!--\s?WIDGET_FRAMEWORK_HOLDER\s?-->/,
            rJsHolder = /<!--\s?WIDGET_JS_HOLDER\s?-->/;

        // ƴ��css�ļ�����
        this.cssFiles.forEach(function(_uri) {
            strCss += '    <link rel="stylesheet" href="' + _uri + '">\n';
        });
        // ƴ����Ƕcss�����
        if(this.cssBlocks.length > 0) {
            strCss += '<style>';
            this.cssBlocks.forEach(function (block) {
                strCss += block;
            });
            strCss += '</style>\n';
        }
        if(rCssHolder.test(content)) {
            content = content.replace(rCssHolder, strCss);
        } else {
            // css����</head>��ǩ֮ǰ
            content = content.replace(/(<\/head>)/i, strCss + '$1');
        }

        // js modules�������
        if(this.framework !== '') {
            strFrameWork = '<script data-loader src="' + this.framework + '"></script>\n';
            if(rFrameWorkHolder.test(content)) {
                content.replace(rFrameWorkHolder, strFrameWork);
            } else {
                // js����</body>��ǩ֮ǰ
                content = content.replace(/(<\/body>)/i, strFrameWork + '$1');
            }
        }

        // ��ģ�黯ֱ��ƴ��script��ǩ
        this.jsFiles.forEach(function(_uri) {
            strJs += '<script src="' + _uri + '"></script>\n';
        });
        // ģ�黯����
        if(loader) {
            // ���δ����ͬ�����أ������strJs
            if(!loadSync) {
                strJs = '';
            }
            switch(loader) {
                case 'require':
                case 'requirejs':
                case 'modjs':
                    strJs += '<script>require(["' + self.jsFiles.join('","') + '"]);</script>\n';
                    break;
                case 'seajs.use':
                case 'seajs':
                    strJs += '<script>seajs.use(["' + self.jsFiles.join('","') + '"]);</script>\n';
            }
        }
        // ƴ����Ƕjs�����
        if(this.jsBlocks.length > 0) {
            strJs += '<script type="text/javascript">\n';
            this.jsBlocks.forEach(function(block) {
                strJs += block;
            });
            strJs += '</script>\n';
        }
        if(rJsHolder.test(content)) {
            content = content.replace(rJsHolder, strJs);
        } else {
            // js����</body>��ǩ֮ǰ
            content = content.replace(/(<\/body>)/i, strJs + '$1');
        }

        return content;
    },
    /*
     * �����������vm��mock�ļ������������棬�����ļ��޸�ʱ���Զ�����
     */
    addDeps: function() {
        var self = this,
            opt = this.opt,
            file = this.file,
            root = opt.root,
            arr = [];

        // ���ȫ��mock��context
        if(opt.commonMock) {
            arr.push(opt.commonMock);
        }

        // ��ҳ���ļ�ͬ��mock�ļ�����context
        var pageMock = this.getAbsolutePath(this.replaceExt(this.file.subpath, '.mock'), root);
        if(pageMock) {
            arr.push(pageMock);
        }

        arr = arr.concat(this.vmFiles);
        arr = arr.concat(this.mockFiles);

        arr.forEach(function(_uri) {
            _uri && file.cache.addDeps(_uri);
        });
    }
};

module.exports = function(content, file, opt) {
    return new VMParser(content, file, opt);
};