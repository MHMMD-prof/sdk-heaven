import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { AdminCollectionState, AdminStatusBadge, AdminSurface } from './AdminUi';
import { AccountDeletionJob, requestAccountDeletionJobs, retryAccountDeletionJob } from './adminDashboardApi';

export function DeletionOperationsPanel({ user }: { user: User }) {
  const [jobs, setJobs] = useState<AccountDeletionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyUid, setBusyUid] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setJobs(await requestAccountDeletionJobs(user)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل عمليات الحذف.'); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  const retry = async (uid: string) => {
    setBusyUid(uid);
    try { await retryAccountDeletionJob(user, uid); await load(); }
    catch (retryError) { setError(retryError instanceof Error ? retryError.message : 'تعذرت إعادة المحاولة.'); }
    finally { setBusyUid(''); }
  };

  return (
    <AdminSurface className="user-directory-surface">
      <div className="user-card-heading"><div><p className="eyebrow">الامتثال والخصوصية</p><h3>عمليات حذف الحسابات</h3></div><button className="secondary-button compact" onClick={() => void load()} type="button">تحديث</button></div>
      <AdminCollectionState empty={!loading && !error && jobs.length === 0} emptyMessage="لا توجد عمليات حذف" error={error || undefined} loading={loading} loadingMessage="جارٍ تحميل عمليات الحذف…" onRetry={() => void load()}>
        {!loading && !error ? <div className="user-table-wrap"><table className="user-directory-table"><thead><tr><th>UID</th><th>الحالة</th><th>موعد الحذف</th><th>المحاولات</th><th>التنبيه</th><th /></tr></thead><tbody>{jobs.map((job) => {
          const aging = job.purgeAfter && new Date(job.purgeAfter).getTime() < Date.now();
          return <tr key={job.uid}><td dir="ltr">{job.uid}</td><td><AdminStatusBadge tone={job.state === 'failed' ? 'danger' : job.state === 'completed' ? 'success' : job.hold ? 'warning' : 'neutral'}>{job.hold ? 'محجوز قانونياً' : job.state}</AdminStatusBadge></td><td>{job.purgeAfter ? new Date(job.purgeAfter).toLocaleString('ar-IQ') : '—'}</td><td>{job.retryCount}</td><td>{aging && job.state !== 'completed' ? 'متأخر' : job.lastError || '—'}</td><td>{job.state === 'failed' && !job.hold ? <button disabled={busyUid === job.uid} onClick={() => void retry(job.uid)} type="button">إعادة المحاولة</button> : null}</td></tr>;
        })}</tbody></table></div> : null}
      </AdminCollectionState>
    </AdminSurface>
  );
}
