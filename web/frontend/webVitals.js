
import { onCLS, onINP, onLCP, onTTFB, onFCP} from 'web-vitals';


export function reportWebVitals(callback) {
  try {
    onCLS(callback);
    onLCP(callback);
    onINP(callback);
    onTTFB(callback);
     onFCP(callback);
   } catch (err) {
    console.error('Web vitals error', err);
  }
}

   
 


