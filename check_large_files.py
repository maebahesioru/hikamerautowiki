import os
from pathlib import Path

def count_lines(file_path):
    """ファイルの行数をカウント"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return len(f.readlines())
    except:
        return 0

def find_large_files(root_dir='.', min_lines=500, extensions=None):
    """指定行数以上のファイルを検索"""
    if extensions is None:
        extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.scss']
    
    large_files = []
    
    # 除外するディレクトリ
    exclude_dirs = {'node_modules', '.next', '.git', 'dist', 'build', '__pycache__'}
    
    for root, dirs, files in os.walk(root_dir):
        # 除外ディレクトリをスキップ
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        
        for file in files:
            # 拡張子チェック
            if any(file.endswith(ext) for ext in extensions):
                file_path = os.path.join(root, file)
                line_count = count_lines(file_path)
                
                if line_count >= min_lines:
                    large_files.append((file_path, line_count))
    
    return sorted(large_files, key=lambda x: x[1], reverse=True)

if __name__ == '__main__':
    print("🔍 500行以上のファイルを検索中...\n")
    
    large_files = find_large_files(min_lines=500)
    
    if large_files:
        print(f"📊 見つかったファイル: {len(large_files)}件\n")
        print(f"{'ファイルパス':<70} {'行数':>10}")
        print("=" * 82)
        
        for file_path, line_count in large_files:
            # 色分け
            if line_count >= 1000:
                status = "🔴"
            elif line_count >= 700:
                status = "🟡"
            else:
                status = "🟢"
            
            print(f"{status} {file_path:<67} {line_count:>10,}行")
        
        print("\n凡例: 🔴 1000行以上 🟡 700-999行 🟢 500-699行")
    else:
        print("✅ 500行以上のファイルは見つかりませんでした！")
