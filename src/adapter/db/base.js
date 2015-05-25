'use strict';

let querystring = require('querystring');

let wait = think.require('await')
let awaitInstance = new wait();

//数据库连接
let dbConnections = {};
//获取数据配置的基本信息
let getDbItem = function(value, index){
  value = value || "";
  if (think.isString(value)) {
    value = value.split(',');
  }
  return index !== undefined ? (value[index] || value[0]) : value;
}

/**
 * 数据库基类
 * @return {[type]} [description]
 */
module.exports = class {
  /**
   * constructor
   * @param  {} args []
   * @return {}      []
   */
  constructor(...args){
    this.init(...args);
  }
  /**
   * init
   * @return {} []
   */
  init(config = {}){
    this.sql = '';
    this.config = config;
    this.lastInsertId = 0;
    this.selectSql = 'SELECT%DISTINCT% %FIELD% FROM %TABLE%%JOIN%%WHERE%%GROUP%%HAVING%%ORDER%%LIMIT% %UNION%%COMMENT%';
    this.comparison = {
      'EQ': '=',
      'NEQ': '!=',
      '<>': '!=',
      'GT': '>',
      'EGT': '>=',
      'LT': '<',
      'ELT': '<=',
      'NOTLIKE': 'NOT LIKE',
      'LIKE': 'LIKE',
      'IN': 'IN',
      'NOTIN': 'NOT IN'
    }
  }
  /**
   * 初始化数据库连接
   * @param  {[type]} master [description]
   * @return {[type]}        [description]
   */
  initConnect(master){
    let hosts = getDbItem(this.config.host);
    //单个host
    if (hosts.length === 1) {
      return this.getConnection(0, this.connect, [this.config]);
    }
    return this.multiConnect(master);
  }
  /**
   * 分布式连接
   * @return {[type]} [description]
   */
  multiConnect(master){
    let config = this.config;
    let index = 0;
    let hostnameLength = getDbItem(config.host).length;
    //读写分离
    if (config.rw_separate) {
      if (master) {
        index = rand(0, config.master_num - 1);
      }else{
        if (isNumber(config.slave_no)) {
          index = config.slave_no;
        }else{
          index = rand(config.master_num, hostnameLength - 1);
        }
      }
    }else{
      index = rand(0, hostnameLength - 1);
    }
    let dbConfig = {
      user: getDbItem(config.user, index),
      password: getDbItem(config.password, index),
      host: getDbItem(config.host, index),
      port: getDbItem(config.port, index),
      database: getDbItem(config.database, index),
      charset: getDbItem(config.charset, index),
    }
    dbConfig = extend({}, config, dbConfig);
    return this.getConnection(index, this.connect, [dbConfig]);
  }
  /**
   * 获取数据连接句柄
   * @param  {[type]}   index    [description]
   * @param  {Function} callback [description]
   * @param  {[type]}   data     [description]
   * @return {[type]}            [description]
   */
  getConnection(index, callback, data){
    let key = think.md5(JSON.stringify(this.config));
    if (!(key in dbConnections)) {
      dbConnections[key] = [];
    }
    if (dbConnections[key][index]) {
      return dbConnections[key][index];
    }
    let connection = callback.apply(this, data);
    this.linkId = dbConnections[key][index] = connection;
    return connection;
  }
  /**
   * parse set
   * @param  {Object} data []
   * @return {String}      []
   */
  parseSet(data = {}){
    let set = [];
    for(let key in data){
      let value = this.parseValue(data[key]);
      if (think.isString(value)) {
        set.push(this.parseKey(key) + '=' + value);
      }
    }
    if(set.length){
      return ' SET ' + set.join(',');
    }
    return '';
  }
  /**
   * parse key
   * @param  {String} key []
   * @return {String}     []
   */
  parseKey(key){
    return key;
  }
  /**
   * parse value
   * @param  {Mixed} value []
   * @return {Mixed}       []
   */
  parseValue(value){
    if (think.isString(value)) {
      value = '\'' + this.escapeString(value) + '\'';
    }else if(think.isArray(value)){
      if (/^exp$/.test(value[0])) {
        value = value[1];
      }else{
        value = value.map(item => this.parseValue(item));
      }
    }else if(think.isBoolean(value)){
      value = value ? '1' : '0';
    }else if (value === null) {
      value = 'null';
    }
    return value;
  }
  /**
   * parse field
   * parseField('name');
   * parseField('name,email');
   * parseField({
   *     xx_name: 'name',
   *     xx_email: 'email'
   * })
   * @return {String} []
   */
  parseField(fields){
    if (think.isString(fields) && fields.indexOf(',') > -1) {
      fields = fields.split(',');
    }
    if (think.isArray(fields)) {
      return fields.map(item => this.parseKey(item)).join(',');
    }else if(think.isObject(fields)){
      let data = [];
      for(let key in fields){
        data.push(this.parseKey(key) + ' AS ' + this.parseKey(fields[key]));
      }
      return data.join(',');
    }else if(think.isString(fields) && fields){
      return this.parseKey(fields);
    }
    return '*';
  }
  /**
   * parse table
   * @param  {Mixed} tables []
   * @return {}        []
   */
  parseTable(table){
    if (think.isString(table)) {
      table = table.split(',');
    }
    if (think.isArray(table)) {
      return table.map(item => this.parseKey(item)).join(',');
    }else if (think.isObject(table)) {
      let data = [];
      for(let key in table){
        data.push(this.parseKey(key) + ' AS ' + this.parseKey(table[key]));
      }
      return data.join(',');
    }
    return '';
  }
  /**
   * parse where
   * @param  {Mixed} where []
   * @return {String}       []
   */
  parseWhere(where = {}){
    let whereStr = '';
    if (think.isString(where)) {
      whereStr = where;
    }else{
      let oList = ['AND', 'OR', 'XOR'];
      let operate = (where._logic + '').toUpperCase();
      delete where._logic;
      operate = oList.indexOf(operate) > -1 ? ' ' + operate + ' ' : ' AND ';
      //safe key regexp
      let keySafeRegExp = /^[\w\|\&\-\.\(\)\,]+$/;
      let multi = where._multi;
      delete where._multi;
      let val;
      let fn = (item, i) => {
        let v = multi ? val[i] : val;
        return '(' + this.parseWhereItem(this.parseKey(item), v) + ')';
      };
      for(let key in where){
        key = key.trim();
        val = where[key];
        whereStr += '( ';
        if (key.indexOf('_') === 0) {
          whereStr += this.parseThinkWhere(key, val);
        }else{
          if (!keySafeRegExp.test(key)) {
            console.log(key + ' is not safe');
            continue;
          }
          let arr;
          // support name|title|nickname
          if (key.indexOf('|') > -1) {
            arr = key.split('|');
            whereStr += arr.map(fn).join(' OR ');
          }else if (key.indexOf('&') > -1) {
            arr = key.split('&');
            whereStr += arr.map(fn).join(' AND ');
          }else{
            whereStr += this.parseWhereItem(this.parseKey(key), val);
          }
        }
        whereStr += ' )' + operate;
      }
      whereStr = whereStr.substr(0, whereStr.length - operate.length);
    }

    return whereStr ? (' WHERE ' + whereStr) : '';
  }
 /**
  * parse where item
  * @param  {String} key []
  * @param  {Mixed} val []
  * @return {String}     []
  */
  parseWhereItem(key, val){
    if (think.isObject(val)) { // {id: {'<': 10, '>': 1}}
      let logic = (val._logic || 'AND').toUpperCase();
      delete val._logic;
      let result = [];
      for(let opr in val){
        let nop = opr.toUpperCase();
        nop = this.comparison[nop] || nop;
        result.push(key + ' ' + nop + ' ' + this.parseValue(val[opr]));
      } 
      return result.join(' ' + logic + ' ');
    }else if (!think.isArray(val)) {
      return key + ' = ' + this.parseValue(val);
    }
    let whereStr = '';
    let data;
    if (think.isString(val[0])) {
      let val0 = val[0].toUpperCase();
      val0 = this.comparison[val0] || val0;
      if (/^(=|!=|>|>=|<|<=)$/.test(val0)) { // compare
        whereStr += key + ' ' + val0 + ' ' + this.parseValue(val[1]);
      }else if (/^(NOT\s+LIKE|LIKE)$/.test(val0)) { // like
        if (think.isArray(val[1])) { //
          let likeLogic = (val[2] || 'OR').toUpperCase();
          let likesLogic = ['AND','OR','XOR'];
          if (likesLogic.indexOf(likeLogic) > -1) {
            let like = val[1].map(item => key + ' ' + val0 + ' ' + this.parseValue(item)).join(' ' + likeLogic + ' ');
            whereStr += '(' + like + ')';
          }
        }else{
          whereStr += key + ' ' + val0 + ' ' + this.parseValue(val[1]);
        }
      }else if(val0 === 'EXP'){ // 使用表达式
        whereStr += '(' + key + ' ' + val[1] + ')';
      }else if(val0 === 'IN' || val0 === 'NOT IN'){ // IN 运算
        if (val[2] === 'exp') {
          whereStr += key + ' ' + val0 + ' ' + val[1];
        }else{
          if (think.isString(val[1])) {
            val[1] = val[1].split(',');
          }
          //如果不是数组，自动转为数组
          if (!think.isArray(val[1])) {
            val[1] = [val[1]];
          }
          val[1] = this.parseValue(val[1]);
          //如果只有一个值，那么变成＝或者!=
          if (val[1].length === 1) {
            whereStr += key + (val0 === 'IN' ? ' = ' : ' != ') + val[1];
          }else{
            whereStr += key + ' ' + val0 + ' (' + val[1].join(',') + ')';
          }
        }
      }else if(val0 === 'BETWEEN'){ // BETWEEN运算
        data = think.isString(val[1]) ? val[1].split(',') : val[1];
        if (!think.isArray(data)) {
          data = [val[1], val[2]];
        }
        whereStr += ' (' + key + ' ' + val0 + ' ' + this.parseValue(data[0]);
        whereStr += ' AND ' + this.parseValue(data[1]) + ')';
      }else{
        console.log('_EXPRESS_ERROR_', key, val);
        return '';
      }
    }else{
      let length = val.length;
      let rule = 'AND';
      if (think.isString(val[length - 1])) {
        let last = val[length - 1].toUpperCase();
        if (last && ['AND', 'OR', 'XOR'].indexOf(last) > -1) {
          rule = last;
          length--;
        }
      }
      for(let i = 0; i < length; i++){
        let isArr = think.isArray(val[i]);
        data = isArr ? val[i][1] : val[i];
        let exp = ((isArr ? val[i][0] : '') + '').toUpperCase();
        if (exp === 'EXP') {
          whereStr += '(' + key + ' ' + data + ') ' + rule + ' ';
        }else{
          let op = isArr ? (this.comparison[val[i][0].toUpperCase()] || val[i][0]) : '=';
          whereStr += '(' + key + ' ' + op + ' ' + this.parseValue(data) + ') ' + rule + ' ';
        }
      }
      whereStr = whereStr.substr(0, whereStr.length - 4);
    }
    return whereStr;
  }
  /**
   * parse special condition
   * @param  {String} key []
   * @param  {Mixed} val []
   * @return {String}     []
   */
  parseThinkWhere(key, val){
    switch(key){
      case '_string':
        return val;
      case '_complex':
        return this.parseWhere(val).substr(6);
      case '_query':
        let where = think.isString(val) ? querystring.parse(val) : val;
        let op = ' AND ';
        if (where._logic) {
          op = ' ' + where._logic.toUpperCase() + ' ';
          delete where._logic;
        }
        let arr = [];
        for(let name in where){
          val = this.parseKey(name) + ' = ' + this.parseValue(where[name]);
          arr.push(val);
        }
        return arr.join(op);
    }
    return '';
  }
  /**
   * 解析limit，对非法的limit进行过滤
   * @param  {[type]} limit [description]
   * @return {[type]}       [description]
   */
  parseLimit(limit){
    if (!limit) {
      return '';
    }
    if(think.isString(limit)){
      limit = limit.split(',');
    }
    let data = [limit[0] | 0];
    if(limit[1]){
      data.push(limit[1] | 0);
    }
    return ' LIMIT ' + data.join(',');
  }
  /**
   * 解析join
   * @param  {[type]} join [description]
   * @return {[type]}      [description]
   */
  parseJoin(join, options){
    if (!join) {
      return '';
    }
    let joinStr = '';
    let defaultJoin = ' LEFT JOIN ';
    if (think.isArray(join)) {
      let joins = {
        'left': ' LEFT JOIN ',
        'right': ' RIGHT JOIN ',
        'inner': ' INNER JOIN '
      };
      join.forEach(val => {
        if (think.isString(val)) {//字符串，直接拼接
          let hasJoin = val.toLowerCase().indexOf(' join ') > -1;
          joinStr += (hasJoin ? ' ' : defaultJoin) + val;
        }else if (think.isObject(val)) {
          let ret = [];
          if (!('on' in val)) {
            for(let key in val){
              let v = val[key];
              v.table = key;
              ret.push(v);
            }
          }else{
            ret.push(val);
          }
          ret.forEach(item => {
            let joinType = joins[item.join] || item.join || defaultJoin;
            // join 表中包含空格、tab等，认为是sql语句使用情况，与buildSql结合使用
            let table = item.table.trim();
            if( /\s+/.test(table) ) {
              if( table.indexOf('(') !== 0 ) {
                table = '(' + table + ')';
              }
              joinStr += joinType + table;
            } else {
              table = options.tablePrefix + table;
              joinStr += joinType + '`' + table + '`';
            }
            if (item.as) {
              joinStr += ' AS ' + item.as;
            }
            //ON条件
            if (item.on) {
              let mTable = options.alias || options.table;
              let jTable = item.as || table;
              //多个＝条件
              if (think.isObject(item.on)) {
                let where = [];
                for(let key in item.on){
                  where.push([
                    key.indexOf('.') > -1 ? key : (mTable + '.`' + key + '`'),
                    '=',
                    item.on[key].indexOf('.') > -1 ? item.on[key] : (jTable + '.`' + item.on[key] + '`')
                  ].join(''));
                }
                joinStr += ' ON (' + where.join(' AND ') + ')';
              }else{
                if (think.isString(item.on)) {
                  item.on = item.on.split(/\s*,\s*/);
                }
                joinStr += ' ON ' + (item.on[0].indexOf('.') > -1 ? item.on[0] : (mTable + '.`' + item.on[0] + '`'));
                joinStr += '=' + (item.on[1].indexOf('.') > -1 ? item.on[1] : (jTable + '.`' + item.on[1] + '`'));
              }
            }
          })
        }
      });
    }else{
      joinStr += defaultJoin + join;
    }
    return joinStr;
  }
  /**
   * 解析order
   * @param  {[type]} order [description]
   * @return {[type]}       [description]
   */
  parseOrder(order){
    if (think.isArray(order)) {
      order = order.map(item => this.parseKey(item)).join(',');
    }else if (think.isObject(order)) {
      let arr = [];
      for(let key in order){
        let val = order[key];
        val = this.parseKey(key) + ' ' + val;
        arr.push(val);
      }
      order = arr.join(',');
    }
    return order ? (' ORDER BY ' + order) : '';
  }
  /**
   * 解析group
   * @param  {[type]} group [description]
   * @return {[type]}       [description]
   */
  parseGroup(group){
    if (!group) {
      return '';
    }
    if (think.isString(group)) {
      group = group.split(',');
    }
    let result = [];
    group.forEach(item => {
      item = item.trim();
      if (!item) {
        return;
      }
      if (item.indexOf('.') === -1) {
        result.push('`' + item + '`');
      }else{
        item = item.split('.');
        result.push(item[0] + '.`' + item[1] + '`'); 
      }
    })
    if (!result.length) {
      return '';
    }
    return ' GROUP BY ' + result.join(',');
  }
  /**
   * 解析having
   * @param  {[type]} having [description]
   * @return {[type]}        [description]
   */
  parseHaving(having){
    return having ? (' HAVING ' + having) : '';
  }
  /**
   * 解析注释，一般情况下用不到
   * @param  {[type]} comment [description]
   * @return {[type]}         [description]
   */
  parseComment(comment){
    return comment ? (' /* ' + comment + '*/') : '';   
  }
  /**
   * 解析Distinct
   * @param  {[type]} distinct [description]
   * @return {[type]}          [description]
   */
  parseDistinct(distinct){
    return distinct ? ' Distinct ' : '';
  }
  /**
   * 解析Union
   * @param  {[type]} union [description]
   * @return {[type]}       [description]
   */
  parseUnion(union){
    if (!union) {
      return '';
    }
    if (think.isArray(union)) {
      let sql = '';
      union.forEach(item => {
        sql += item.all ? 'UNION ALL ' : 'UNION ';
        sql += '(' + (think.isObject(item.union) ? this.buildSelectSql(item.union).trim() : item.union) + ') ';
      })
      return sql;
    }else{
      return 'UNION (' + (think.isObject(union) ? this.buildSelectSql(union).trim() : union) + ') '; 
    }
  }
  /**
   * 解析Lock
   * @param  {[type]} lock [description]
   * @return {[type]}      [description]
   */
  parseLock(lock){
    if (!lock) {
      return '';
    }
    return ' FOR UPDATE ';
  }
  /**
   * 将page转化为sql里的limit
   * @return {[type]} [description]
   */
  pageToLimit(options){
    options = options || {};
    //根据page生成limit
    if ('page' in options) {
      let page = options.page + '';
      let listRows = 0;
      if (page.indexOf(',') > -1) {
        page = page.split(',');
        listRows = page[1] | 0;
        page = page[0];
      }
      page = parseInt(page, 10) || 1;
      if (!listRows) {
        listRows = isNumberString(options.limit) ? options.limit : think.config('db_nums_per_page');
      }
      let offset = listRows * (page - 1);
      options.limit = offset + ',' + listRows;
    }
    return options;
  }
  /**
   * 拼接select查询语句
   * @param  {[type]} options [description]
   * @return {[type]}         [description]
   */
  buildSelectSql(options){
    //options = this.pageToLimit(options);
    let sql = this.parseSql(this.selectSql, options);
    sql += this.parseLock(options.lock);
    return sql;
  }
  /**
   * 解析sql语句
   * @param  {[type]} sql     [description]
   * @param  {[type]} options [description]
   * @return {[type]}         [description]
   */
  parseSql(sql, options = {}){
    return sql.replace(/\%([A-Z]+)\%/g, (a, type) => {
      type = type.toLowerCase();
      let ucfirst = type[0].toUpperCase() + type.slice(1);
      return this['parse' + ucfirst](options[type] || '', options);
    }).replace(/__([A-Z_-]+)__/g, (a, b) => {
      return '`' + this.config.prefix + b.toLowerCase() + '`';
    });
  }
  /**
   * 插入一条记录
   * @param  {[type]} data    [description]
   * @param  {[type]} options [description]
   * @param  {[type]} replace [description]
   * @return {[type]}         [description]
   */
  insert(data = {}, options = {}, replace){
    let values = [];
    let fields = [];
    for(let key in data){
      let val = data[key];
      val = this.parseValue(val);
      if (think.isString(val)) {
        values.push(val);
        fields.push(this.parseKey(key));
      }
    }
    let sql = (replace ? 'REPLACE' : 'INSERT') + ' INTO ';
    sql += this.parseTable(options.table) + ' (' + fields.join(',') + ') ';
    sql += 'VALUES(' + values.join(',') + ')';
    sql += this.parseLock(options.lock) + this.parseComment(options.comment);
    return this.execute(sql);
  }
  /**
   * 插入多条记录
   * @param  {[type]} data    [description]
   * @param  {[type]} options [description]
   * @param  {[type]} replace [description]
   * @return {[type]}         [description]
   */
  insertAll(data, options, replace){
    let fields = Object.keys(data[0]);
    
    fields = fields.map(item => this.parseKey(item)).join(',');
    let values = data.map(item => {
      let value = [];
      for(let key in item){
        let val = item[key];
        val = this.parseValue(val);
        if (isScalar(val)) {
          value.push(val);
        }
      }
      return '(' + value.join(',') + ')';
    }).join(',');
    let sql = replace ? 'REPLACE' : 'INSERT';
    sql += ' INTO ' + this.parseTable(options.table) + '(' + fields + ') VALUES ' + values;
    return this.execute(sql);
  }
  /**
   * 从一个选择条件的结果插入记录
   * @param  {[type]} fields  [description]
   * @param  {[type]} table   [description]
   * @param  {[type]} options [description]
   * @return {[type]}         [description]
   */
  selectAdd(fields, table, options){
    options = options || {};
    this.model = options.model;
    if (think.isString(fields)) {
      fields = fields.split(',');
    }
    
    fields = fields.map(item => this.parseKey(item));
    let sql = 'INSERT INTO ' + this.parseTable(table) + ' (' + fields.join(',') + ') ';
    sql += this.buildSelectSql(options);
    return this.execute(sql);
  }
  /**
   * 删除记录
   * @param  {[type]} options [description]
   * @return {[type]}         [description]
   */
  delete(options = {}){
    options = options || {};
    this.model = options.model;
    let sql = [
      'DELETE FROM ',
      this.parseTable(options.table),
      this.parseWhere(options.where),
      this.parseOrder(options.order),
      this.parseLimit(options.limit),
      this.parseLock(options.lock),
      this.parseComment(options.comment)
    ].join('');
    return this.execute(sql);
  }
  /**
   * 更新数据
   * @param  {[type]} data    [description]
   * @param  {[type]} options [description]
   * @return {[type]}         [description]
   */
  update(data, options){
    options = options || {};
    this.model = options.model;
    let sql = [
      'UPDATE ',
      this.parseTable(options.table),
      this.parseSet(data),
      this.parseWhere(options.where),
      this.parseOrder(options.order),
      this.parseLimit(options.limit),
      this.parseLock(options.lock),
      this.parseComment(options.comment)
    ].join('');
    return this.execute(sql);
  }
  /**
   * 数据查询
   * @todo 返回是个promise，缓存调用需要修改
   * @param  {[type]} options [description]
   * @return {[type]}         [description]
   */
  select(options){
    let sql, cache;
    if (think.isString(options) && options.toUpperCase().indexOf('SELECT ') > -1) {
      sql = options;
      cache = arguments[1];
    }else{
      options = options || {};
      this.model = options.model;
      sql = this.buildSelectSql(options);
      cache = options.cache;
    }
    
    if (!think.isEmpty(cache) && think.config('db_cache_on')) {
      let key = cache.key || md5(sql);
      return S(key, () => this.query(sql), cache);
    }
    return this.query(sql);
  }
  /**
   * 转义字符
   * @param  {[type]} str [description]
   * @return {[type]}     [description]
   */
  escapeString(str){
    if (!str) {
      return '';
    }
    return str.replace(/[\0\n\r\b\t\\\'\"\x1a]/g, s =>  {
      switch(s) {
        case '\0': 
          return '\\0';
        case '\n': 
          return '\\n';
        case '\r': 
          return '\\r';
        case '\b': 
          return '\\b';
        case '\t': 
          return '\\t';
        case '\x1a': 
          return '\\Z';
        default:   
          return '\\'+s;
      }
    });
  }
  /**
   * 获取上次的sql语句
   * @param  {[type]} model [description]
   * @return {[type]}       [description]
   */
  getLastSql(model){
    return model ? this.modelSql[model] : this.sql;
  }
  /**
   * 获取最后插入的id
   * @return {[type]} [description]
   */
  getLastInsertId(){
    return this.lastInsertId;
  }
  /**
   * 查询一条sql
   * @param  string str
   * @return promise
   */
  query(str){
    return awaitInstance.run(str, () => {
      return this.initConnect(false).query(str).then(data => {
        return this.bufferToString(data);
      });
    })
  }
  /**
   * 将buffer转为string
   * @param  {[type]} data [description]
   * @return {[type]}      [description]
   */
  bufferToString(data){
    if (!think.config('db_buffer_tostring') || !think.isArray(data)) {
      return data;
    }
    for(let i = 0, length = data.length; i < length; i++){
      for(let key in data[i]){
        if(think.isBuffer(data[i][key])){
          data[i][key] = data[i][key].toString();
        }
      }
    }
    return data;
  }
  /**
   * 执行一条sql, 返回影响的行数
   * @param  {[type]} str [description]
   * @return {[type]}     [description]
   */
  execute(str){
    return this.initConnect(true).query(str).then(data => {
      if (data.insertId) {
        this.lastInsertId = data.insertId;
      }
      return data.affectedRows || 0;
    });
  }
  /**
   * 关闭连接
   * @return {[type]} [description]
   */
  close(){
    if (this.linkId) {
      this.linkId.close();
      this.linkId = null;
    }
  }
}