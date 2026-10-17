import { useCallback, useEffect, useRef, useState, FC, FormEvent, ChangeEvent } from 'react';
import { api, tokenStore, ApiError } from './api';

const App: FC = () => {
  const [authed, setAuthed] = useState(() => !!tokenStore.get());
  const logout = useCallback(() => {
    tokenStore.clear();
    setAuthed(false);
  }, []);
  return authed ? <Tasks onLogout={logout} /> : <Login onAuthed={() => setAuthed(true)} />;
};

interface LoginProps {
  onAuthed: () => void;
}

const Login: FC<LoginProps> = ({ onAuthed }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const data = await api<{ accessToken: string; refreshToken: string }>(`/auth/${mode}`, {
        method: 'POST',
        body: { email: f.get('email'), password: f.get('password') },
      });
      tokenStore.set(data);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <>
      <h1>TaskFlow</h1>
      <form onSubmit={submit}>
        <input name="email" type="email" placeholder="email" required />
        <input name="password" type="password" placeholder="password (8+)" minLength={8} required />
        <button>{mode}</button>
      </form>
      {error && <p className="err">{error}</p>}
      <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        switch to {mode === 'login' ? 'register' : 'login'}
      </button>
    </>
  );
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Task {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  version: number;
}

interface TasksResponse {
  items: Task[];
  nextCursor: string | null;
}

interface TasksProps {
  onLogout: () => void;
}

const Tasks: FC<TasksProps> = ({ onLogout }) => {
  const [items, setItems] = useState<Task[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (nextCursor: string | null) => {
      const seq = ++requestSeq.current;
      const qs = new URLSearchParams({ limit: '10' });
      if (status) qs.set('status', status);
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (nextCursor) qs.set('cursor', nextCursor);
      try {
        const page = await api<TasksResponse>(`/tasks?${qs}`);
        if (seq !== requestSeq.current) return;
        setItems((prev) => (nextCursor ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError('');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onLogout();
        } else {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      }
    },
    [status, debouncedSearch, onLogout]
  );

  useEffect(() => {
    load(null);
  }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = new FormData(e.currentTarget).get('title') as string;
    e.currentTarget.reset();
    try {
      const task = await api<Task>('/tasks', { method: 'POST', body: { title } });
      setItems((prev) => [task, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function toggle(task: Task) {
    const next = task.status === 'done' ? 'todo' : 'done';
    const before = items;
    setItems((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next as Task['status'] } : t)));
    try {
      const updated = await api<Task>(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: next },
        headers: { 'if-match': `"${task.version}"` },
      });
      setItems((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setItems(before);
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setError('Changed elsewhere, reloaded.');
        load(null);
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }
  }

  async function remove(id: string) {
    try {
      await api(`/tasks/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <>
      <h1>
        TaskFlow <button onClick={onLogout}>logout</button>
      </h1>
      <form onSubmit={add}>
        <input name="title" placeholder="New task" required />
        <button>Add</button>
      </form>
      <form onSubmit={(e) => e.preventDefault()}>
        <input value={search} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} placeholder="Search" />
        <select value={status} onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value)}>
          <option value="">all</option>
          <option value="todo">todo</option>
          <option value="in_progress">in progress</option>
          <option value="done">done</option>
        </select>
      </form>
      {error && <p className="err">{error}</p>}
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} />
            <span className={t.status === 'done' ? 'done' : ''}>{t.title}</span>
            <button onClick={() => remove(t.id)}>x</button>
          </li>
        ))}
      </ul>
      {cursor && <button onClick={() => load(cursor)}>Load more</button>}
    </>
  );
};

export default App;
