import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs'; // 需要 fs 来检查文件是否存在
import { app } from 'electron'; // 导入 app 模块判断是否打包



// --- 全局变量存储数据库连接 ---
let db: Database.Database | null = null;

interface RawDictionaryRow {
  word: string;
  usphone: string;
  ukphone: string;
  translations: string | null; // JSON 字符串或 NULL
  sentences: string | null;    // 'sentence' 在您的代码中，可能是笔误，假设是 'sentences'
  phrases: string | null;
  synonyms: string | null;
  antonyms: string | null;
  relatedWords: string | null;
  bookId: string;
  // 确保这里的属性名和大小写与数据库列名完全一致
}

/**
 * 初始化/获取数据库连接
 * @returns {Database.Database}
 */
export function getDbConnection(dbFilePath:string): Database.Database {
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
                  console.error(`Could not read directory ${path.dirname(dbFilePath)}.`);
              }
              throw new Error(`Database file not found. Path checked: ${dbFilePath}. Ensure the file exists and the path is correct relative to the execution environment (dev vs packaged). Also check electron-builder extraResources config.`);
          }
  
          // 尝试打开数据库
          db = new Database(dbFilePath, { readonly: true, fileMustExist: true });
          //console.log('Database connection opened successfully.');
  
          // Electron 应用退出时关闭连接
          app?.on('will-quit', () => {
            if (db && db.open) { // 检查 db 是否存在且连接是打开的
              db.close();
              console.log('Database connection closed on app quit.');
              db = null; // 清理引用
            }
          });
  
      } catch (error) {
          console.error(`Failed to open database at ${dbFilePath}:`, error);
          db = null; // 确保失败时 db 为 null
          throw error; // 重新抛出错误，让调用者知道失败了
      }
    }
    return db;
  }
export function getOneEnglishWord(word:string,dbFilePath:string):EnglishDictionaryWord|null{
    const connection = getDbConnection(dbFilePath); // 获取数据库连接

    // 准备查询语句
    const sql = `SELECT word, usphone, ukphone, translations, sentences, phrases,synonyms,antonyms,relatedWords,bookId FROM dictionary WHERE LOWER(word) = ?`;
    const stmt = connection.prepare(sql);

    // 执行查询
    try {
      const row = stmt.get(word) as RawDictionaryRow;
      if(!row){
        console.log(`单词${word}在词典中不存在`);
        return null;
      }
      const englishWord :EnglishDictionaryWord = {
        word:row.word,
        usphone:row.usphone,
        ukphone:row.ukphone,
        translations:JSON.parse(row.translations||'[]'),
        sentences:JSON.parse(row.sentences||'[]'),
        phrases:JSON.parse(row.phrases||'[]'),
        synonyms:JSON.parse(row.synonyms||'[]'),
        antonyms:JSON.parse(row.antonyms||'[]'),
        relatedWords:JSON.parse(row.relatedWords||'[]'),
        bookId:row.bookId
      };
      return englishWord;
    } catch (error) {
      console.error(`Failed to get one english word: ${error}`);
      return null;
    }
}