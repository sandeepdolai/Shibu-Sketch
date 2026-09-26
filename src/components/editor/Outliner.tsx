'use client';

/**
 * ACAN3D — scene outliner: searchable object tree with selection,
 * rename, visibility, duplicate/delete and grouping. All mutations go
 * through runCommand().
 */

import * as React from 'react';
import {
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  Eye,
  EyeOff,
  Folder,
  Group,
  Lightbulb,
  Lock,
  Pencil,
  Search,
  Square,
  Trash2,
  Video,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { runCommand, useEditor } from '@/lib/engine/store';
import type { ObjectInfo } from '@/lib/engine/types';

/* ------------------------------------------------------------------ */

function typeIcon(o: ObjectInfo): React.ElementType {
  if (o.pageMeta) return BookOpen;
  if (o.type === 'mesh') return Box;
  if (o.type === 'group') return Folder;
  if (o.type === 'light') return Lightbulb;
  if (o.type === 'camera') return Video;
  return Square;
}

/* ------------------------------------------------------------------ */

interface TreeRowProps {
  obj: ObjectInfo;
  depth: number;
  selected: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
}

function RowMenuItems({
  obj,
  onStartEdit,
}: {
  obj: ObjectInfo;
  onStartEdit: (id: string) => void;
}) {
  const selection = useEditor((s) => s.selection);
  return (
    <>
      <ContextMenuItem onSelect={() => onStartEdit(obj.id)}>
        <Pencil size={12} />
        Rename
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => void runCommand('duplicate_object', { objectId: obj.id })}
      >
        <Copy size={12} />
        Duplicate
      </ContextMenuItem>
      <ContextMenuItem
        disabled={selection.length < 2}
        onSelect={() => void runCommand('create_group', { objectIds: selection })}
      >
        <Group size={12} />
        Group selection
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onSelect={() => void runCommand('delete_object', { objectId: obj.id })}
      >
        <Trash2 size={12} />
        Delete
      </ContextMenuItem>
    </>
  );
}

function TreeRow({
  obj,
  depth,
  selected,
  hasChildren,
  collapsed,
  onToggleCollapse,
  editing,
  onStartEdit,
  onEndEdit,
}: TreeRowProps) {
  const [draft, setDraft] = React.useState(obj.name);

  React.useEffect(() => {
    if (editing) setDraft(obj.name);
  }, [editing, obj.name]);

  const iconNode = typeIcon(obj);

  const commitRename = () => {
    const name = draft.trim();
    if (editing && name && name !== obj.name) {
      void runCommand('rename_object', { objectId: obj.id, name });
    }
    onEndEdit();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-selected={selected}
          tabIndex={-1}
          onClick={(e) => {
            void runCommand('select_object', {
              objectId: obj.id,
              additive: e.ctrlKey || e.metaKey || e.shiftKey,
            });
          }}
          onDoubleClick={() => onStartEdit(obj.id)}
          className={cn(
            'group flex h-7 min-w-0 cursor-pointer select-none items-center gap-1 border-l-2 pr-1 text-xs',
            selected
              ? 'border-amber-500 bg-amber-500/15'
              : 'border-transparent hover:bg-accent/50',
          )}
          style={{ paddingLeft: 4 + depth * 12 }}
        >
          {hasChildren ? (
            <button
              aria-label={collapsed ? 'Expand' : 'Collapse'}
              className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(obj.id);
              }}
            >
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span className="size-4 shrink-0" />
          )}

          {React.createElement(iconNode, {
            size: 13,
            className: cn(
              'shrink-0',
              obj.type === 'group'
                ? 'text-muted-foreground'
                : selected
                  ? 'text-amber-600 dark:text-amber-500'
                  : 'text-muted-foreground',
            ),
          })}
          {editing ? (
            <Input
              value={draft}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') onEndEdit();
              }}
              className="h-5 min-w-0 flex-1 rounded-sm px-1 py-0 text-xs"
            />
          ) : (
            <span className={cn('min-w-0 flex-1 truncate', selected && 'font-medium')}>
              {obj.name}
            </span>
          )}

          {obj.locked && <Lock size={11} className="shrink-0 text-muted-foreground" />}

          <button
            aria-label={obj.visible ? 'Hide' : 'Show'}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground',
              obj.visible ? 'sm:opacity-0 sm:group-hover:opacity-100' : 'opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation();
              void runCommand('set_visibility', { objectId: obj.id, visible: !obj.visible });
            }}
          >
            {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Object actions"
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <Ellipsis size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {/* Same actions as the context menu */}
              <DropdownMenuItem onSelect={() => onStartEdit(obj.id)}>Rename</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void runCommand('duplicate_object', { objectId: obj.id })}
              >
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => void runCommand('delete_object', { objectId: obj.id })}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <RowMenuItems obj={obj} onStartEdit={onStartEdit} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ------------------------------------------------------------------ */

export function Outliner({ className }: { className?: string }) {
  const objects = useEditor((s) => s.objects);
  const selection = useEditor((s) => s.selection);
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const selectedSet = React.useMemo(() => new Set(selection), [selection]);
  const q = query.trim().toLowerCase();

  const childrenOf = React.useMemo(() => {
    const map = new Map<string | null, ObjectInfo[]>();
    for (const o of objects) {
      const key = o.parentId && objects.some((p) => p.id === o.parentId) ? o.parentId : null;
      const arr = map.get(key);
      if (arr) arr.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [objects]);

  const matches = React.useCallback(
    (o: ObjectInfo) => !q || o.name.toLowerCase().includes(q),
    [q],
  );

  const subtreeVisible = React.useCallback(
    (o: ObjectInfo): boolean => {
      if (matches(o)) return true;
      const stack = [...(childrenOf.get(o.id) ?? [])];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (matches(cur)) return true;
        stack.push(...(childrenOf.get(cur.id) ?? []));
      }
      return false;
    },
    [childrenOf, matches],
  );

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (o: ObjectInfo, depth: number): React.ReactNode => {
    if (!subtreeVisible(o)) return null;
    const children = childrenOf.get(o.id) ?? [];
    return (
      <React.Fragment key={o.id}>
        <TreeRow
          obj={o}
          depth={depth}
          selected={selectedSet.has(o.id)}
          hasChildren={children.length > 0}
          collapsed={collapsed.has(o.id)}
          onToggleCollapse={toggleCollapse}
          editing={editingId === o.id}
          onStartEdit={setEditingId}
          onEndEdit={() => setEditingId(null)}
        />
        {!collapsed.has(o.id) && children.map((c) => renderNode(c, depth + 1))}
      </React.Fragment>
    );
  };

  const roots = childrenOf.get(null) ?? [];

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Scene
        </span>
        <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
          {objects.length}
        </Badge>
        <div className="relative ml-auto">
          <Search
            size={12}
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search objects"
            className="h-6 w-28 rounded-md pl-6 text-xs"
          />
        </div>
      </div>

      {/* tree */}
      <ScrollArea className="min-h-0 flex-1">
        <div role="tree" className="py-1 pr-0.5">
          {objects.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              Scene is empty — use Add to create objects.
            </p>
          ) : (
            <>
              {roots.map((r) => renderNode(r, 0))}
              {q && objects.every((o) => !subtreeVisible(o)) && (
                <p className="px-3 py-4 text-xs text-muted-foreground">No matches.</p>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
