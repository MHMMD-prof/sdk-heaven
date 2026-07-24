import { Component, ErrorInfo, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  onError: (error: Error, info: ErrorInfo) => void;
  resetKey: string;
};

type State = { error: Error | null };

export class AdminErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  componentDidUpdate(previousProps: Props) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="admin-fatal-state" role="alert"><span aria-hidden="true">!</span><p className="eyebrow">تم تسجيل العطل تشغيليًا</p><h2>تعذّر عرض هذا القسم بأمان</h2><p>لم تُنفّذ أي عملية معلّقة. أعد تحميل القسم، وإن تكرر الخطأ راجع سجل التدقيق التشغيلي.</p><button className="secondary-button" onClick={() => this.setState({ error: null })} type="button">إعادة تحميل القسم</button></section>;
  }
}
