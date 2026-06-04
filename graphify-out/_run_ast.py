import json
from graphify.extract import collect_files, extract
from graphify.cache import check_semantic_cache
from pathlib import Path

if __name__ == '__main__':
    detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))

    # AST extraction on code files
    code_files = []
    for f in detect.get('files', {}).get('code', []):
        p = Path(f)
        code_files.extend(collect_files(p) if p.is_dir() else [p])

    if code_files:
        result = extract(code_files, cache_root=Path('.'))
        Path('graphify-out/.graphify_ast.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
        print('AST: ' + str(len(result['nodes'])) + ' nodes, ' + str(len(result['edges'])) + ' edges')
    else:
        Path('graphify-out/.graphify_ast.json').write_text(json.dumps({'nodes':[],'edges':[],'input_tokens':0,'output_tokens':0}, ensure_ascii=False), encoding='utf-8')
        print('No code files')

    # Cache check for non-audio files
    all_files = [f for ftype, flist in detect.get('files', {}).items() if ftype != 'video' for f in flist]
    cached_nodes, cached_edges, cached_hyperedges, uncached = check_semantic_cache(all_files)

    if cached_nodes or cached_edges or cached_hyperedges:
        Path('graphify-out/.graphify_cached.json').write_text(
            json.dumps({'nodes': cached_nodes, 'edges': cached_edges, 'hyperedges': cached_hyperedges}, ensure_ascii=False),
            encoding='utf-8'
        )
    Path('graphify-out/.graphify_uncached.txt').write_text('\n'.join(uncached), encoding='utf-8')
    print('Cache: ' + str(len(all_files)-len(uncached)) + ' hit, ' + str(len(uncached)) + ' to extract')
