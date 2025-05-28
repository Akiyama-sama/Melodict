import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron'; 
import fs from 'fs';


interface RawPhrasesRow {
  phrase: string;
  translations_json: string;
}
// --- 全局变量存储数据库连接 ---
let db: Database.Database | null = null;
/**
 * 初始化/获取数据库连接
 * @returns {Database.Database}
 */
function getDbConnection(dbFilePath:string): Database.Database {
    // 打印当前工作目录和目标数据库文件路径，帮助诊断路径问题
    //console.log('Current working directory (cwd):', process.cwd());
    //console.log('Resolved database file path:', dbFilePath);

    if (!db) {
      try {
          //console.log(`Attempting to open database at: ${dbFilePath}`);
          // 检查文件是否存在，增加调试信息
          if (!fs.existsSync(dbFilePath)) {
              console.error(`Database file NOT FOUND at: ${dbFilePath}`);
              // 列出目录内容帮助调试 (可选)
              try {
                  const parentDir = path.dirname(dbFilePath);
                  const files = fs.readdirSync(parentDir);
                  console.error(`Files in ${parentDir}:`, files);
              } catch (readDirError) {
                  console.error(`Could not read directory ${path.dirname(dbFilePath)}:`, readDirError);
              }
              throw new Error(`Database file not found. Path checked: ${dbFilePath}. Ensure the file exists and the path is correct relative to the execution environment (dev vs packaged). Also check electron-builder extraResources config.`);
          }
  
          // 尝试打开数据库
          db = new Database(dbFilePath, { readonly: true, fileMustExist: true });
          //console.log('Database connection opened successfully.');
  
          // Electron 应用退出时关闭连接
          // 仅当 app 对象存在时才尝试注册事件
          if (app && typeof app.on === 'function') {
            app.on('will-quit', () => {
              if (db && db.open) { // 检查 db 是否存在且连接是打开的
                db.close();
                console.log('Database connection closed on app quit.');
                db = null; // 清理引用
              }
            });
          }
  
      } catch (error) {
          console.error(`Failed to open database at ${dbFilePath}:`, error);
          db = null; // 确保失败时 db 为 null
          throw error; // 重新抛出错误，让调用者知道失败了
      }
    }
    return db;
  }

export function getAllPhrases(dbFilePath:string):string[]{
    const connection = getDbConnection(dbFilePath); // 获取数据库连接
    const rows = connection.prepare('SELECT phrase FROM phrases').all() as RawPhrasesRow[];
    return rows.map(row => row.phrase);
}

export function getOnePhrase(phrase:string,dbFilePath:string):EnglishDictinaryPhrase|null{
    if (!phrase) return null;
    const phraseLower = phrase.toLowerCase(); 
    const connection = getDbConnection(dbFilePath); // 获取数据库连接
    
    //console.log(`Looking up phrase: '${phraseLower}' in database.`); // 新增日志
    // 修正：确保 SQL 查询也选择了 'translations' 列
    const row = connection.prepare('SELECT phrase, translations_json FROM phrases WHERE phrase = ?').get(phraseLower) as RawPhrasesRow;
    //console.log('Query result (row):', row); // 新增日志

    try {
        if (row && typeof row.translations_json === 'string') {
          const translations:[{
            tran?:string,
            sentence?:string,
            sCN?:string
          }] = JSON.parse(row.translations_json); 
          return {
            phrase:row.phrase,
            translations:translations
          };
        } else {
          if (!row) {
            console.log(`Phrase '${phraseLower}' not found in database.`);
          } else if (row.translations_json === undefined) {
            console.warn(`Phrase '${phraseLower}' found, but 'translations' field is missing from the query result or database schema.`);
          } else if (row.translations_json === null) {
            console.warn(`Phrase '${phraseLower}' found, but 'translations' field is null in the database.`);
          } else if (typeof row.translations_json !== 'string') {
            console.warn(`Phrase '${phraseLower}' found, but 'translations' field is not a string. Type: ${typeof row.translations_json}, Value:`, row.translations_json);
          }
          return null; // 未找到或数据格式不正确
        }
      } catch (error) {
         if (error instanceof SyntaxError) {
             // 特别处理 JSON 解析错误
             console.error(`Error parsing JSON data for phrase "${phraseLower}". Raw translations data: '${row?.translations_json}'. Error:`, error);
         } else {
            console.error(`Error looking up phrase "${phraseLower}":`, error);
         }
        return null;
      }
}

// 建议添加一个函数用于在测试结束后关闭数据库连接（如果需要）
export function closeDbConnection() {
    if (db && db.open) {
        db.close();
        console.log('Database connection closed manually.');
        db = null;
    }
}


