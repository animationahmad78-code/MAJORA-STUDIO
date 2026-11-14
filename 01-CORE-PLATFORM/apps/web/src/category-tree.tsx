import { useEffect, useRef, useState, type ReactNode } from 'react';
import './category-tree.css';

type CategoryNode = { label: string; path: string; value: string; children: CategoryNode[] };

function tree(categories: string[]): CategoryNode[] {
  const roots: CategoryNode[] = [];
  for (const category of categories.filter(Boolean)) {
    let level = roots;
    let path = '';
    const parts = category.split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean);
    for (const [index, part] of parts.entries()) {
      path = path ? `${path} / ${part}` : part;
      let node = level.find(x => x.label === part);
      if (!node) { node = { label: part, path, value: path, children: [] }; level.push(node); }
      if (index === parts.length - 1) node.value = category;
      level = node.children;
    }
  }
  return roots;
}

export function CategoryTree({ categories, value, onChange }: { categories: string[]; value: string; onChange: (value: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const render = (nodes: CategoryNode[], depth = 0): ReactNode => nodes.map(node => <div key={node.path} className="category-node" style={{ paddingInlineStart: depth * 12 }} onMouseEnter={() => { if (node.children.length && window.matchMedia('(hover: hover)').matches) setExpanded(node.path); }}>
    <div className="category-node-row"><button type="button" className={value === node.value ? 'selected' : ''} onClick={() => { onChange(node.value); if (!node.children.length) setExpanded(null); }}>{node.label}</button>{node.children.length > 0 && <button type="button" className="category-arrow" aria-label={`زیر‌دسته‌های ${node.label}`} aria-expanded={expanded === node.path || !!expanded?.startsWith(`${node.path} /`)} onClick={() => setExpanded(expanded === node.path ? null : node.path)}>⌄</button>}</div>
    {(expanded === node.path || !!expanded?.startsWith(`${node.path} /`)) && node.children.length > 0 && <div className="category-children">{render(node.children, depth + 1)}</div>}
  </div>);
  return <div className="category-tree" ref={root} onMouseLeave={() => { if (window.matchMedia('(hover: hover)').matches) setExpanded(null); }}><span className="category-tree-label">دسته‌بندی</span><button type="button" className={!value ? 'selected' : ''} onClick={() => { onChange(''); setExpanded(null); }}>همهٔ دسته‌ها</button>{render(tree(categories))}</div>;
}
