const ContentExtractor = {
  async extractMainContent(document) {
    const reader = new Readability(document.cloneNode(true));
    const article = reader.parse();
    
    // Get AI analysis of the page structure
    const aiAnalysis = await this.analyzeWithAI(document);
    
    return {
      title: article.title || aiAnalysis.title,
      content: await this.structureContent(article.content, aiAnalysis),
      meta: await this.extractMetadata(document, aiAnalysis),
      template: await this.extractTemplate(document, aiAnalysis),
      media: await this.extractMedia(document),
      taxonomies: await this.inferTaxonomies(document, article, aiAnalysis)
    };
  },

  async analyzeWithAI(document) {
    const pageContent = document.documentElement.outerHTML;
    
    // Try multiple AI endpoints in case of failures
    const endpoints = [
      'http://localhost:8080/analyze',  // Local GGUF
      'http://localhost:3000/analyze',  // LocalAI
      'http://localhost:8081/analyze'   // Ollama
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ 
            content: pageContent,
            prompt: this.getAnalysisPrompt()
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          return await response.json();
        }
      } catch (err) {
        console.warn(`AI endpoint ${endpoint} failed:`, err);
        continue;
      }
    }

    // Fallback to basic extraction if all AI fails
    return this.basicAnalysis(document);
  },

  getAnalysisPrompt() {
    return `Analyze this HTML and identify:
      1. Main content sections
      2. Navigation elements
      3. Header/footer components
      4. Sidebar widgets
      5. Content type (article, product, etc)
      6. Metadata structure
      Format response as JSON.`;
  },

  async structureContent(content, aiAnalysis) {
    if (!aiAnalysis) return content;

    // Convert to Gutenberg blocks
    const blocks = [];
    
    for (const section of aiAnalysis.contentSections) {
      switch(section.type) {
        case 'paragraph':
          blocks.push(`<!-- wp:paragraph -->${section.content}<!-- /wp:paragraph -->`);
          break;
        case 'heading':
          blocks.push(`<!-- wp:heading {"level":${section.level}} -->${section.content}<!-- /wp:heading -->`);
          break;
        case 'list':
          blocks.push(`<!-- wp:list -->${section.content}<!-- /wp:list -->`);
          break;
        // Add other block types as needed
      }
    }

    return blocks.join('\n');
  },

  async extractTemplate(document, aiAnalysis) {
    const template = {
      header: await this.convertToThemeComponent(
        aiAnalysis?.headerElements || document.querySelector('header, [role="banner"]')?.outerHTML,
        'header'
      ),
      footer: await this.convertToThemeComponent(
        aiAnalysis?.footerElements || document.querySelector('footer, [role="contentinfo"]')?.outerHTML,
        'footer'
      ),
      navigation: await this.convertToThemeComponent(
        aiAnalysis?.navElements || document.querySelector('nav, [role="navigation"]')?.outerHTML,
        'navigation'
      ),
      sidebar: await this.convertToThemeComponent(
        aiAnalysis?.sidebarElements || document.querySelector('[role="complementary"]')?.outerHTML,
        'sidebar'
      )
    };

    return template;
  },

  async convertToThemeComponent(html, type) {
    if (!html) return null;

    // Convert to WordPress theme component
    const prompt = `Convert this ${type} HTML to a WordPress theme component:
      1. Use WordPress template tags
      2. Make it dynamic
      3. Follow WordPress coding standards`;

    try {
      const response = await fetch('http://localhost:8080/convert', {
        method: 'POST',
        body: JSON.stringify({ html, prompt })
      });
      return await response.json();
    } catch (err) {
      console.warn(`Theme component conversion failed for ${type}`, err);
      return html;
    }
  },

  async inferTaxonomies(document, article, aiAnalysis) {
    const suggestedTaxonomies = aiAnalysis?.taxonomies || {
      categories: [],
      tags: []
    };

    // Extract topics from content using AI
    try {
      const response = await fetch('http://localhost:8080/extract-topics', {
        method: 'POST',
        body: JSON.stringify({ content: article.content })
      });
      const topics = await response.json();
      
      suggestedTaxonomies.categories.push(...topics.mainTopics);
      suggestedTaxonomies.tags.push(...topics.relatedTerms);
    } catch (err) {
      console.warn('Topic extraction failed', err);
    }

    return suggestedTaxonomies;
  },

  extractMetadata(document, aiAnalysis) {
    return {
      description: document.querySelector('meta[name="description"]')?.content,
      publishDate: document.querySelector('.posted-on time, .entry-date')?.dateTime 
        || document.querySelector('meta[property="article:published_time"]')?.content,
      modifiedDate: document.querySelector('meta[property="article:modified_time"]')?.content,
      author: document.querySelector('.author, .entry-author')?.textContent?.trim()
    };
  },

  detectContentType(article) {
    // Check for blog post indicators
    const blogPatterns = [
      'article',
      'post',
      'blog',
      'entry'
    ];
    return blogPatterns.some(pattern => 
      article.uri?.toLowerCase().includes(pattern) ||
      article.title?.toLowerCase().includes(pattern)
    );
  },

  async extractMedia(document) {
    const images = [...document.querySelectorAll('img[src]')].map(img => ({
      url: img.src,
      alt: img.alt,
      caption: img.closest('figure')?.querySelector('figcaption')?.textContent
    }));

    const videos = [...document.querySelectorAll('video source, iframe[src*="youtube"], iframe[src*="vimeo"]')]
      .map(video => ({
        url: video.src,
        type: video.tagName === 'SOURCE' ? 'self-hosted' : 'embedded'
      }));

    return { images, videos };
  },

  extractTaxonomies(document) {
    return {
      categories: [...document.querySelectorAll('.cat-links a, .category a')]
        .map(cat => cat.textContent.trim()),
      tags: [...document.querySelectorAll('.tags-links a, .tag a')]
        .map(tag => tag.textContent.trim())
    };
  }
}; 