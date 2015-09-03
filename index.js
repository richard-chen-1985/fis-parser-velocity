var Engine = require('velocity').Engine,
    Parser = require('velocity').parser,
    path = require('path'),
    util = fis.util;

/**
 * 通过内容获取需要的上下文，读取引入文件的同名xxx-mock.js文件
 * @return
 *  [Object]
 */
function getContext(widgets, root) {
    var context = {};
    
    widgets = util.isArray(widgets) ? widgets : [widgets];
    widgets.forEach(function(widget) {
        var file = getAbsolutePath(replaceExt(widget, '.mock'), root);
        if(file) {
            util.merge(context, require(file));
            delete require.cache[file];
        }
    });

    return context;
}

/**
 * 通过内容获取所有引用的文件
 * @return
 *   [filepath, filepath...]
 */
function getWidgets(filepath, opt) {
    var file = getAbsolutePath(filepath, opt.root),
        result = [],
        content = file ? util.read(file) : '',
        ast = Parser.parse(content);

    if(!ast.body) {
        return result;
    }
    ast.body.forEach(function(p) {
        var value;
        // 只要#parse引入的文件
        if(p.type != 'Parse') {
            return;
        }
        value = p.argument.value;
        // 过滤重复引用
        if(result.indexOf(value) >= 0) {
            return;
        }
        result.push(value);
        result = result.concat(getWidgets(value, opt));
    });

    return result;
}

/** 替换文件的扩展名
 * @example
 * replaceExt('/widget/a/a.html', '.css') => '/widget/a/a.css'
 */
function replaceExt(pathname, ext) {
    return pathname.substring(0, pathname.lastIndexOf('.')) + ext;
}

/**
 * 返回文件绝对路径，因为root为数组，所以每个root都得判断一下
 * @param file {String} 文件相对路径
 * @param root {Array} root目录数组
 * @return {String} 返回文件绝对路径或者null
 */
function getAbsolutePath(file, root) {
    var result = null;
    for(var i = 0; i < root.length; i++) {
        if(util.exists(path.join(root[i], file))) {
            result = path.join(root[i], file);
            break;
        }
    }
    return result;
}

/**
 * 添加静态资源依赖
 */
function addStatics(widgets, content, opt) {
    var 
        // css文件数组
        arrCss = [],
        // js文件数组
        arrJs = [],
        // js拼接字符串
        strJs = '',
        // 模块化加载函数名称[require|seajs.use]
        loader = opt.loader || null,
        loadJs = opt.loadJs,
        root = opt.root,
        rCssHolder = /<!--\s?WIDGET_CSS_HOLDER\s?-->/,
        rJsHolder = /<!--\s?WIDGET_JS_HOLDER\s?-->/;
    
    widgets.forEach(function(widget) {
        var widget = widget[0] === '/' ? widget : '/' + widget,
            scssFile = replaceExt(widget, '.scss'),
            lessFile = replaceExt(widget, '.less'),
            cssFile = replaceExt(widget, '.css'),
            jsFile = replaceExt(widget, '.js');
            
        if(getAbsolutePath(scssFile, root)) {
            arrCss.push('<link rel="stylesheet" href="' + scssFile + '">\n');
        }
        if(getAbsolutePath(lessFile, root)) {
            arrCss.push('<link rel="stylesheet" href="' + lessFile + '">\n')
        }
        if(getAbsolutePath(cssFile, root)) {
            arrCss.push('<link rel="stylesheet" href="' + cssFile + '">\n');
        }
        if(loadJs && getAbsolutePath(jsFile, root)) {
            // 模块化加载，只保存文件路径
            if(loader) {
                arrJs.push(jsFile.substring(1, jsFile.lastIndexOf('.')));
            } else {
                arrJs.push('<script src="' + jsFile + '"></script>\n');
            }
        }
    });
    
    if(arrJs.length > 0) {
        // 非模块化直接拼接script标签
        if(!loader) {
            strJs = arrJs.join('');
        } else {
            // 模块化加载依赖
            // e.g. require(["a", "b]);
            strJs = '<script>' + loader + '(["' + arrJs.join('","') + '"]);</script>\n';
        }
    }

    if(rCssHolder.test(content)) {
        content = content.replace(rCssHolder, arrCss.join(''));
    } else {
        // css放在</head>标签之前
        content = content.replace(/(<\/head>)/i, arrCss.join('') + '$1');
    }

    if(rJsHolder.test(content)) {
        content = content.replace(rJsHolder, strJs);
    } else {
        // js放在</body>标签之前
        content = content.replace(/(<\/body>)/i, strJs + '$1');
    }

    return content;
}

/** 
 * 对文件内容进行渲染
 */
function renderTpl(content, file, opt) {
    var widgets,
        context,
        pageMock,
        root = opt.root,
        parse = opt.parse;
    
    if (content === '') {
        return content;
    }
    
    // 通过ast树获取#parse引入的文件
    widgets = getWidgets(file.subpath, opt);

    // 将页面文件同名xxx-mock.js文件加入context
    context = getContext(file.subpath, root);

    // 将页面文件同名xxx-mock.js加入依赖缓存，用于同步更新
    pageMock = getAbsolutePath(replaceExt(file.subpath, '.mock'), root);
    pageMock && addDeps(file, pageMock);

    // 将widgets的xxx-mock.js文件加入context
    util.merge(context, getContext(widgets, root));

    // 得到解析后的文件内容
    content = parse ? new Engine(opt).render(context) : content;

    // 添加widgets的js和css依赖到输入内容
    content = addStatics(widgets, content, opt);

    // 添加widget依赖到fis缓存，用于同步更新
    widgets.forEach(function(widget) {
        var tpl = getAbsolutePath(widget, root);
        var mock = getAbsolutePath(replaceExt(widget, '.mock'), root);
        tpl && addDeps(file, tpl);
        mock && addDeps(file, mock);
    });

    return content;
}

/*
 * 对引入本widget的文件添加FIS依赖，当本widget模板文件修改时，自动编译
 * @param {Object} a
 * @param {Object} b
 */
function addDeps(a, b) {
    if (a && a.cache && b) {
        if (b.cache) {
            a.cache.mergeDeps(b.cache);
        }
        a.cache.addDeps(b.realpath || b);
    }
}

/**
 * fis-parser-velocity
 * @example
 * fis.match('*.vm', {
 *   parser: fis.plugin('velocity', {
 *     // 是否引入js
 *     loadJs: true,
 *     // 模块化加载函数 [require|seajs.use]
 *     // 为null时，每个js文件用script标签引入<script src="/widget/a/a.js"></script><script src="/widget/b/b.js"></script>
 *     // 为require时，会是require(["/widget/a/a.js", "/widget/b/b.js"]);
 *     // 为seajs.use时，会是seajs.use(["/widget/a/a.js", "/widget/b/b.js"]);
 *     loader: null,
 *     // 全局macro文件，相对于root
 *     macro: '/page/macro.vm',
 *     // 是否编译内容，默认为true，为false时不编译velocity语法，只引用资源依赖
 *     parse: true,
 *     // velocity的root配置，默认为项目根目录
 *     root: [fis.project.getProjectPath()]
 *	 }),
 *   rExt: '.html',
 * });
 * @param content
 * @param file
 * @param settings
 * @returns {String} 编译后的html内容
 */
module.exports = function(content, file, settings) {
    var root = fis.project.getProjectPath();
    //clone opt, because velocity may modify opt
    var opt = {
        loadJs: true,
        loader: null,
        macro: null,
        parse: true,
        root: [root]
    };
    util.merge(opt, settings);
    opt.template = content;
    opt.macro = getAbsolutePath(opt.macro, opt.root);
    return renderTpl(content, file, opt);
};