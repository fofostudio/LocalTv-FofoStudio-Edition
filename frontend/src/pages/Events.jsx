import DailyEvents from '../components/DailyEvents/DailyEvents';
import styles from './Events.module.css';

export default function Events() {
  return (
    <div className={styles.eventsPage}>
      <DailyEvents />
    </div>
  );
}
