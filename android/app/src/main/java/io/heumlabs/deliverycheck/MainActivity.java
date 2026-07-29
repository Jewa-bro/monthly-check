package io.heumlabs.deliverycheck;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

public class MainActivity extends AppCompatActivity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // APK 안의 파일을 https 주소로 제공한다.
        // file:// 로 열면 localStorage 가 웹뷰 버전에 따라 사라질 수 있어서 이렇게 한다
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage — 실적이 여기 저장된다
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);           // 필요 없으므로 막는다
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                    // 시스템 글꼴 배율과 무관하게 만든 크기를 유지
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setOverScrollMode(View.OVER_SCROLL_NEVER);   // 위아래 끝에서 늘어나는 효과 제거
        web.setBackgroundColor(0xFFF2F4F6);
        web.setVerticalScrollBarEnabled(false);
        web.setLongClickable(false);

        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        // 시스템 뒤로가기를 웹 히스토리에 연결한다.
        // 홈(히스토리 뿌리)에서 누르면 canGoBack() 이 false 라서 앱이 닫힌다
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        if (savedInstanceState == null) {
            web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }
}
